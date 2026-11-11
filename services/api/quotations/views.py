from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from xml.sax.saxutils import escape

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from rest_framework import serializers
from rest_framework.response import Response

from catalogue.items import item_hsn
from catalogue.views import eligible_products
from config.india import INDIAN_MOBILE_PATTERN
from dealers.onboarding import DealerView
from dealers.views import audit, business, page
from orders.business_calendar import business_datetime
from .models import Bill, Estimate, EstimateLine


def money(value):
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calculate(subtotal, discount_rate, gst_type, gst_rate):
    discount = money(subtotal * discount_rate / 100)
    taxable = subtotal - discount
    tax = money(taxable * gst_rate / 100)
    cgst = money(tax / 2) if gst_type == 'CGST_SGST' else Decimal('0.00')
    sgst = tax - cgst if gst_type == 'CGST_SGST' else Decimal('0.00')
    igst = tax if gst_type == 'IGST' else Decimal('0.00')
    return {name: str(value) for name, value in {
        'sub_total': subtotal, 'discount_amount': discount, 'taxable_amount': taxable,
        'cgst_amount': cgst, 'sgst_amount': sgst, 'igst_amount': igst, 'total_amount': taxable + tax,
    }.items()}


class LineInput(serializers.Serializer):
    product = serializers.IntegerField(min_value=1)
    quantity = serializers.DecimalField(max_digits=9, decimal_places=3, min_value=Decimal('0.001'))


class EstimateInput(serializers.Serializer):
    items = LineInput(many=True, min_length=1, max_length=100)
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    customer_mobile = serializers.RegexField(INDIAN_MOBILE_PATTERN, required=False, allow_blank=True, default='')
    discount_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)
    gst_type = serializers.ChoiceField(choices=['CGST_SGST', 'IGST'])
    gst_rate_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)
    status = serializers.ChoiceField(choices=['DRAFT', 'SHARED'], required=False, default='DRAFT')

    def validate_items(self, items):
        if len({item['product'] for item in items}) != len(items):
            raise serializers.ValidationError('Each product can appear only once.')
        return items


class LineOutput(serializers.ModelSerializer):
    class Meta:
        model = EstimateLine
        fields = ['product', 'product_name', 'hsn_sac_code', 'unit_price', 'quantity', 'line_total']


class EstimateOutput(serializers.ModelSerializer):
    items = LineOutput(many=True)
    totals = serializers.DictField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = Estimate
        fields = ['id', 'customer_name', 'customer_mobile', 'status', 'discount_percentage', 'gst_type',
                  'gst_rate_percentage', 'totals', 'items', 'created_at']


class BillOutput(serializers.ModelSerializer):
    class Meta:
        model = Bill
        fields = ['id', 'bill_number', 'issued_at', 'snapshot', 'payment_status']


def save_estimate(request, dealer, estimate=None):
    serializer = EstimateInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    lines = data.pop('items')
    previous = {row.product_id: row for row in estimate.items.all()} if estimate else {}
    missing = [row['product'] for row in lines if row['product'] not in previous]
    current = eligible_products().filter(catalogue_price__isnull=False).in_bulk(missing)
    if len(current) != len(missing):
        raise serializers.ValidationError({'items': 'One or more products are unavailable or have no list price.'})
    snapshots = []
    for row in lines:
        old = previous.get(row['product'])
        product = current.get(row['product'])
        price = old.unit_price if old else product.catalogue_price
        snapshots.append(EstimateLine(product_id=row['product'], product_name=old.product_name if old else product.name,
            hsn_sac_code=old.hsn_sac_code if old else item_hsn(product), unit_price=price, quantity=row['quantity'],
            line_total=money(price * row['quantity'])))
    data.update(calculate(sum((row.line_total for row in snapshots), Decimal('0.00')),
                          data['discount_percentage'], data['gst_type'], data['gst_rate_percentage']))
    if estimate is None:
        estimate = Estimate.objects.create(dealer=dealer, **data)
    else:
        for key, value in data.items():
            setattr(estimate, key, value)
        estimate.save(update_fields=data.keys())
        estimate.items.all().delete()
    for row in snapshots:
        row.estimate = estimate
    EstimateLine.objects.bulk_create(snapshots)
    audit(request, dealer, 'ESTIMATE_SAVED', {'estimate': estimate.pk, 'status': estimate.status})
    return estimate


class Estimates(DealerView):
    def get(self, request):
        return page(request, Estimate.objects.filter(dealer=self.owner(request)).prefetch_related('items').order_by('-pk'), EstimateOutput)

    @transaction.atomic
    def post(self, request):
        dealer = business(request, verified=True)
        return Response(EstimateOutput(save_estimate(request, dealer)).data, status=201)


class EstimateDetail(DealerView):
    @transaction.atomic
    def patch(self, request, pk):
        dealer = business(request, verified=True)
        estimate = get_object_or_404(Estimate.objects.select_for_update(), dealer=dealer, pk=pk)
        if estimate.status not in (Estimate.Status.DRAFT, Estimate.Status.SHARED):
            return Response({'detail': 'This estimate is finalized.'}, status=409)
        if request.data == {'status': 'CANCELLED'}:
            estimate.status = Estimate.Status.CANCELLED
            estimate.save(update_fields=['status'])
            audit(request, dealer, 'ESTIMATE_CANCELLED', {'estimate': estimate.pk})
        else:
            estimate = save_estimate(request, dealer, estimate)
        return Response(EstimateOutput(estimate).data)


class ConvertToBill(DealerView):
    @transaction.atomic
    def post(self, request, pk):
        # The dealer row lock serializes sequence allocation and conversion retries.
        dealer = business(request, verified=True)
        estimate = get_object_or_404(Estimate.objects.select_for_update(), dealer=dealer, pk=pk)
        previous = Bill.objects.filter(estimate=estimate).first()
        if previous:
            return Response(BillOutput(previous).data)
        if estimate.status != Estimate.Status.SHARED:
            return Response({'detail': 'Confirm the estimate before converting it to a bill.'}, status=409)
        year = business_datetime(timezone.now()).year
        prefix = f'INV-{year}-{dealer.pk}-'
        sequence = Bill.objects.filter(bill_number__startswith=prefix).count() + 1
        snapshot = dict(EstimateOutput(estimate).data)
        snapshot.update(dealer_name=dealer.legal_name, dealer_gstin=dealer.gstin)
        bill = Bill.objects.create(estimate=estimate, snapshot=snapshot, bill_number=f'{prefix}{sequence:04d}')
        estimate.status = Estimate.Status.CONVERTED_TO_BILL
        estimate.save(update_fields=['status'])
        audit(request, dealer, 'ESTIMATE_CONVERTED_TO_BILL', {'estimate': estimate.pk, 'bill': bill.pk})
        return Response(BillOutput(bill).data, status=201)


class Bills(DealerView):
    def get(self, request):
        return page(request, Bill.objects.filter(estimate__dealer=self.owner(request)).order_by('-pk'), BillOutput)


def document_pdf(title, snapshot, issued_at):
    output = BytesIO()
    styles = getSampleStyleSheet()
    story = [Paragraph(escape(title), styles['Title'])]
    rows = [
        'Date (IST): ' + business_datetime(issued_at).strftime('%d-%m-%Y'),
        'Dealer: ' + snapshot['dealer_name'], 'GSTIN: ' + (snapshot['dealer_gstin'] or 'Not provided'),
        'Customer: ' + (snapshot['customer_name'] or 'Not provided'),
    ]
    for item in snapshot['items']:
        rows.append(f"{item['product_name']} | HSN/SAC {item['hsn_sac_code'] or '-'} | "
                    f"{item['quantity']} × INR {item['unit_price']} | INR {item['line_total']}")
    rows.extend(f"{name.replace('_', ' ').title()}: INR {value}" for name, value in snapshot['totals'].items())
    rows.append(f"Discount {snapshot['discount_percentage']}% | GST {snapshot['gst_rate_percentage']}% ({snapshot['gst_type']})")
    for row in rows:
        story.extend([Paragraph(escape(row), styles['BodyText']), Spacer(1, 6)])
    SimpleDocTemplate(output).build(story)
    return output.getvalue()


def pdf_response(title, snapshot, date, filename):
    response = HttpResponse(document_pdf(title, snapshot, date), content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}.pdf"'
    return response


class EstimatePDF(DealerView):
    def get(self, request, pk):
        dealer = self.owner(request)
        estimate = get_object_or_404(Estimate.objects.prefetch_related('items'), dealer=dealer, pk=pk)
        snapshot = dict(EstimateOutput(estimate).data)
        snapshot.update(dealer_name=dealer.legal_name, dealer_gstin=dealer.gstin)
        return pdf_response(f'Estimate {pk}', snapshot, estimate.created_at, f'Estimate-{pk}')


class BillPDF(DealerView):
    def get(self, request, pk):
        bill = get_object_or_404(Bill, estimate__dealer=self.owner(request), pk=pk)
        return pdf_response(f'Bill {bill.bill_number}', bill.snapshot, bill.issued_at, bill.bill_number)
