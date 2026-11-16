from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from xml.sax.saxutils import escape

from django.db import transaction
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle
from rest_framework import serializers
from rest_framework.response import Response

from catalogue.items import item_hsn
from catalogue.views import eligible_products
from config.india import INDIAN_MOBILE_PATTERN
from dealers.onboarding import DealerView
from dealers.models import DealerCustomItem
from dealers.views import audit, business, page
from orders.business_calendar import business_datetime
from .models import Bill, Estimate, EstimateLine


def money(value):
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calculate(subtotal, discount_rate, gst_type, gst_rate, *, line_tax=None):
    discount = money(subtotal * discount_rate / 100)
    taxable = subtotal - discount
    tax = money(taxable * gst_rate / 100) if line_tax is None else line_tax
    cgst = money(tax / 2) if gst_type == 'CGST_SGST' else Decimal('0.00')
    sgst = tax - cgst if gst_type == 'CGST_SGST' else Decimal('0.00')
    igst = tax if gst_type == 'IGST' else Decimal('0.00')
    return {name: str(value) for name, value in {
        'sub_total': subtotal, 'discount_amount': discount, 'taxable_amount': taxable,
        'cgst_amount': cgst, 'sgst_amount': sgst, 'igst_amount': igst, 'total_amount': taxable + tax,
    }.items()}


class LineInput(serializers.Serializer):
    product = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False, allow_null=True)
    dealer_custom_item = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False, allow_null=True)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False)
    quantity = serializers.DecimalField(max_digits=9, decimal_places=3, min_value=Decimal('0.001'))
    discount_mode = serializers.ChoiceField(choices=EstimateLine.DiscountMode.choices, required=False)
    discount_value = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=0, required=False)

    def validate(self, attrs):
        if bool(attrs.get('product')) == bool(attrs.get('dealer_custom_item')):
            raise serializers.ValidationError('Select exactly one catalogue product or General Item.')
        if attrs.get('product') and 'unit_price' in attrs:
            raise serializers.ValidationError({'unit_price': 'Catalogue prices come from the catalogue snapshot.'})
        return attrs


class EstimateInput(serializers.Serializer):
    items = LineInput(many=True, min_length=1, max_length=100)
    customer_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    customer_mobile = serializers.RegexField(INDIAN_MOBILE_PATTERN, required=False, allow_blank=True, default='')
    discount_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)
    gst_type = serializers.ChoiceField(choices=['CGST_SGST', 'IGST'])
    gst_rate_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)
    status = serializers.ChoiceField(choices=['DRAFT', 'SHARED'], required=False, default='DRAFT')

    def validate_items(self, items):
        if len({(item.get('product'), item.get('dealer_custom_item')) for item in items}) != len(items):
            raise serializers.ValidationError('Each product can appear only once.')
        return items


class LineOutput(serializers.ModelSerializer):
    product_code = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()
    net_unit_rate = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = EstimateLine
        fields = ['product', 'dealer_custom_item', 'source', 'product_name', 'product_code', 'hsn_sac_code',
                  'list_price_per_unit', 'unit_price', 'quantity',
                  'discount_mode', 'discount_value', 'net_unit_rate', 'line_total']

    def get_product_code(self, line):
        return line.product.code if line.list_price_per_unit is None and line.product_id else line.product_code

    def get_source(self, line):
        return 'GENERAL' if line.dealer_custom_item_id else 'CATALOGUE'


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
    previous = {(row.product_id, row.dealer_custom_item_id): row for row in estimate.items.select_related('product')} if estimate else {}
    missing = [(row.get('product'), row.get('dealer_custom_item')) for row in lines
               if (row.get('product'), row.get('dealer_custom_item')) not in previous]
    product_ids = [product_id for product_id, _ in missing if product_id]
    custom_ids = [custom_id for _, custom_id in missing if custom_id]
    current = eligible_products().filter(catalogue_price__isnull=False).in_bulk(product_ids)
    if len(current) != len(product_ids):
        raise serializers.ValidationError({'items': 'One or more products are unavailable or have no list price.'})
    custom = DealerCustomItem.objects.select_for_update().filter(dealer=dealer, is_active=True).in_bulk(custom_ids)
    if len(custom) != len(custom_ids):
        raise Http404('One or more General Items are unavailable.')
    snapshots = []
    for row in lines:
        product_id, custom_id = row.get('product'), row.get('dealer_custom_item')
        old = previous.get((product_id, custom_id))
        if old:
            name, hsn = old.product_name, old.hsn_sac_code
            code = old.product_code if old.list_price_per_unit is not None or not product_id else old.product.code
            list_price = old.list_price_per_unit if old.list_price_per_unit is not None else old.unit_price
            price = row.get('unit_price', old.unit_price)
        elif custom_id:
            item = custom[custom_id]
            name, code, hsn = item.product_name, item.product_code, item.hsn_sac_code
            list_price = item.list_price_per_unit
            price = row.get('unit_price', list_price)
        else:
            product = current[product_id]
            name, code, hsn = product.name, product.code, item_hsn(product)
            list_price = price = product.catalogue_price
        discount_mode = row.get('discount_mode', old.discount_mode if old else EstimateLine.DiscountMode.PERCENT)
        discount_value = row.get('discount_value', old.discount_value if old else Decimal('0'))
        limit = price if discount_mode == EstimateLine.DiscountMode.AMOUNT else Decimal('100')
        if discount_value > limit:
            raise serializers.ValidationError({'items': 'An item discount cannot exceed its unit price or 100%.'})
        line = EstimateLine(product_id=product_id, dealer_custom_item_id=custom_id, product_name=name,
            product_code=code, hsn_sac_code=hsn, list_price_per_unit=list_price, unit_price=price, quantity=row['quantity'],
            discount_mode=discount_mode, discount_value=discount_value)
        line.line_total = money(line.net_unit_rate * line.quantity)
        snapshots.append(line)
    line_tax = None
    if any(row.discount_value for row in snapshots):
        if data['discount_percentage']:
            raise serializers.ValidationError({'discount_percentage': 'Use either item discounts or an estimate-wide discount.'})
        line_tax = sum(money(row.line_total * data['gst_rate_percentage'] / 100) for row in snapshots)
    data.update(calculate(sum((row.line_total for row in snapshots), Decimal('0.00')),
                          data['discount_percentage'], data['gst_type'], data['gst_rate_percentage'], line_tax=line_tax))
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
        return page(request, Estimate.objects.filter(dealer=self.owner(request)).prefetch_related('items__product').order_by('-pk'), EstimateOutput)

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
    for row in rows:
        story.extend([Paragraph(escape(row), styles['BodyText']), Spacer(1, 6)])
    lines = [['#', 'Item / Code / HSN', 'Qty', 'Rate (INR)', 'GST %', 'Amount (INR)']]
    subtotal = Decimal('0')
    legacy_percent = Decimal(snapshot['discount_percentage'])
    for index, item in enumerate(snapshot['items'], 1):
        rate = Decimal(item.get('net_unit_rate', item['unit_price']))
        if legacy_percent:
            rate = money(rate * (100 - legacy_percent) / 100)
        amount = money(rate * Decimal(item['quantity']))
        subtotal += amount
        description = ' | '.join(filter(None, (item['product_name'], item.get('product_code'), item['hsn_sac_code'])))
        lines.append([index, Paragraph(escape(description), styles['BodyText']), item['quantity'],
                      format(rate, '.2f') if rate == money(rate) else str(rate), snapshot['gst_rate_percentage'], str(amount)])
    lines.append(['', 'Subtotal', '', '', '', str(subtotal)])
    table = LongTable(lines, colWidths=[24, 158, 45, 67, 42, 114], repeatRows=1)
    table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F1F5F9')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
    ]))
    story.extend([table, Spacer(1, 12)])
    totals = snapshot['totals']
    adjustment = Decimal(totals['taxable_amount']) - subtotal
    if adjustment:
        story.append(Paragraph(f'Rate rounding: INR {adjustment}', styles['BodyText']))
    for key, label in [('taxable_amount', 'Taxable amount'), ('cgst_amount', 'CGST'), ('sgst_amount', 'SGST'),
                       ('igst_amount', 'IGST'), ('total_amount', 'Grand total')]:
        if key in ('taxable_amount', 'total_amount') or Decimal(totals[key]):
            story.append(Paragraph(f"{label}: INR {totals[key]}", styles['BodyText']))
    SimpleDocTemplate(output, pagesize=A4).build(story)
    return output.getvalue()


def pdf_response(title, snapshot, date, filename):
    response = HttpResponse(document_pdf(title, snapshot, date), content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}.pdf"'
    return response


class EstimatePDF(DealerView):
    def get(self, request, pk):
        dealer = self.owner(request)
        estimate = get_object_or_404(Estimate.objects.prefetch_related('items__product'), dealer=dealer, pk=pk)
        snapshot = dict(EstimateOutput(estimate).data)
        snapshot.update(dealer_name=dealer.legal_name, dealer_gstin=dealer.gstin)
        return pdf_response(f'Estimate {pk}', snapshot, estimate.created_at, f'Estimate-{pk}')


class BillPDF(DealerView):
    def get(self, request, pk):
        bill = get_object_or_404(Bill, estimate__dealer=self.owner(request), pk=pk)
        return pdf_response(f'Bill {bill.bill_number}', bill.snapshot, bill.issued_at, bill.bill_number)
