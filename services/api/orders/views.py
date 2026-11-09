from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from accounts.models import AccountType, BusinessProfile, StaffRoleAssignment
from catalogue.views import Pages
from companies.permissions import HasStaffPermission
from enquiries.models import QuotationRevision
from enquiries.views import IsBuyer, IsDealer, dealer_profile
from .models import Invoice,InvoiceAudit,InvoiceSequence,Order,OrderAudit,OrderItem
from .pdf import invoice_pdf
from .business_calendar import financial_year
from .serializers import InvoiceCreateSerializer,OrderActionSerializer,OrderCreateSerializer,OrderSerializer

CENT=Decimal('.01')
def records(): return Order.objects.select_related('buyer','business__account','branch','quotation','invoice').prefetch_related('items','audit_events').order_by('-pk')
def page(request,qs):
    p=Pages(); rows=p.paginate_queryset(qs,request); return p.get_paginated_response(OrderSerializer(rows,many=True).data)
def snapshot(order): return OrderSerializer(records().get(pk=order.pk)).data
def audit(order,actor,action,reason=''): OrderAudit.objects.create(order=order,actor=actor,action=action,reason=reason,snapshot=snapshot(order))
def fy(now):
    return financial_year(now)

class BuyerOrders(APIView):
    permission_classes=[IsBuyer]
    def get(self,request): return page(request,records().filter(buyer=request.user))
    @transaction.atomic
    def post(self,request):
        s=OrderCreateSerializer(data=request.data);s.is_valid(raise_exception=True)
        quote=get_object_or_404(QuotationRevision.objects.select_for_update().select_related('enquiry__branch__business'),pk=s.validated_data['quotation'],enquiry__buyer=request.user)
        if quote.state!=QuotationRevision.State.ACCEPTED or quote.enquiry.state!='ACCEPTED': raise ValidationError('Only the accepted quotation may become an order.')
        if hasattr(quote,'order'): return Response({'code':'ORDER_EXISTS','message':'This quotation already has an order.','order':OrderSerializer(quote.order).data},status=409)
        order=Order.objects.create(quotation=quote,buyer=request.user,business=quote.enquiry.branch.business,branch=quote.enquiry.branch,order_number='STO-'+uuid4().hex[:20].upper())
        for item in quote.items.select_related('enquiry_item__listing__product','enquiry_item__listing__variant'):
            listing=item.enquiry_item.listing
            OrderItem.objects.create(order=order,quotation_item=item,product_id_snapshot=listing.product_id,product_name=listing.product.name,product_code=listing.product.code,variant_id_snapshot=listing.variant_id,variant_sku=listing.variant.sku if listing.variant else '',quantity=item.quantity,unit_price=item.unit_price,currency='INR')
        audit(order,request.user,'ORDER_CREATED'); return Response(OrderSerializer(records().get(pk=order.pk)).data,status=201)

class BuyerOrderDetail(APIView):
    permission_classes=[IsBuyer]
    def get(self,request,pk): return Response(OrderSerializer(get_object_or_404(records(),pk=pk,buyer=request.user)).data)

class BuyerCancelOrder(APIView):
    permission_classes=[IsBuyer]
    @transaction.atomic
    def post(self,request,pk):
        order=get_object_or_404(Order.objects.select_for_update(),pk=pk,buyer=request.user); reason=str(request.data.get('reason','')).strip()
        if not reason: raise ValidationError({'reason':'A cancellation reason is required.'})
        if order.state not in [Order.State.PENDING,Order.State.CONFIRMED]: raise ValidationError('This order can no longer be cancelled by the buyer.')
        order.state=Order.State.CANCELLED;order.save(update_fields=['state','updated_at']);audit(order,request.user,'ORDER_CANCELLED',reason);return Response(OrderSerializer(records().get(pk=pk)).data)

class DealerOrders(APIView):
    permission_classes=[IsDealer]
    def get(self,request):
        dealer=get_object_or_404(BusinessProfile,account=request.user);return page(request,records().filter(business=dealer))

class DealerOrderDetail(APIView):
    permission_classes=[IsDealer]
    def get(self,request,pk): return Response(OrderSerializer(get_object_or_404(records(),pk=pk,business__account=request.user)).data)

TRANSITIONS={'CONFIRM':('PENDING','CONFIRMED'),'REJECT':('PENDING','REJECTED'),'PROCESSING':('CONFIRMED','PROCESSING'),'READY':('PROCESSING','READY'),'COMPLETE':('READY','COMPLETED')}
class DealerOrderAction(APIView):
    permission_classes=[IsDealer]
    @transaction.atomic
    def post(self,request,pk):
        dealer=dealer_profile(request);order=get_object_or_404(Order.objects.select_for_update(),pk=pk,business=dealer);s=OrderActionSerializer(data=request.data);s.is_valid(raise_exception=True);action=s.validated_data['action'];reason=s.validated_data['reason'].strip()
        if action=='CANCEL':
            if order.state not in [Order.State.CONFIRMED,Order.State.PROCESSING,Order.State.READY]: raise ValidationError('This order cannot be cancelled.')
            target=Order.State.CANCELLED
        else:
            source,target=TRANSITIONS[action]
            if order.state!=source: raise ValidationError(f'Order must be {source} for this transition.')
        order.state=target
        if target==Order.State.CONFIRMED: order.confirmed_at=timezone.now();order.save(update_fields=['state','confirmed_at','updated_at'])
        else: order.save(update_fields=['state','updated_at'])
        audit(order,request.user,'ORDER_'+target,reason);return Response(OrderSerializer(records().get(pk=pk)).data)

class DealerInvoiceCreate(APIView):
    permission_classes=[IsDealer]
    @transaction.atomic
    def post(self,request,pk):
        dealer=dealer_profile(request);order=get_object_or_404(Order.objects.select_for_update().select_related('business'),pk=pk,business=dealer)
        if order.state not in [Order.State.CONFIRMED,Order.State.PROCESSING,Order.State.READY,Order.State.COMPLETED]: raise ValidationError('Only a confirmed order may be invoiced.')
        if hasattr(order,'invoice'): return Response({'code':'INVOICE_EXISTS','message':'This order already has an immutable invoice.','order':OrderSerializer(records().get(pk=pk)).data},status=409)
        s=InvoiceCreateSerializer(data=request.data,context={'order':order});s.is_valid(raise_exception=True);data=s.validated_data;line_inputs={x['order_item']:x for x in data.pop('items')}; now=timezone.now();year=fy(now);seq,_=InvoiceSequence.objects.select_for_update().get_or_create(business=dealer,financial_year=year);number=f'{dealer.pk}/{year}/{seq.next_value:05d}';seq.next_value+=1;seq.save(update_fields=['next_value'])
        subtotal=discount=taxable=cgst=sgst=igst=Decimal('0');snap=[]
        for item in order.items.all():
            row=line_inputs[item.pk];gross=(item.quantity*item.unit_price).quantize(CENT,ROUND_HALF_UP);base=gross-row['discount'];tax=(base*row['tax_rate']/Decimal('100')).quantize(CENT,ROUND_HALF_UP);c=s=t=Decimal('0')
            if row['tax_mode']=='CGST_SGST': c=(tax/2).quantize(CENT,ROUND_HALF_UP);s=tax-c
            elif row['tax_mode']=='IGST': t=tax
            subtotal+=gross;discount+=row['discount'];taxable+=base;cgst+=c;sgst+=s;igst+=t;snap.append({'order_item':item.pk,'product_name':item.product_name,'product_code':item.product_code,'variant_sku':item.variant_sku,'hsn':row['hsn'].strip(),'quantity':str(item.quantity),'unit_price':str(item.unit_price),'discount':str(row['discount']),'taxable_value':str(base),'tax_rate':str(row['tax_rate']),'tax_mode':row['tax_mode'],'cgst':str(c),'sgst':str(s),'igst':str(t)})
        invoice=Invoice(order=order,invoice_number=number,financial_year=year,supplier_name=dealer.legal_name,supplier_gstin=dealer.gstin,subtotal=subtotal,discount_total=discount,taxable_total=taxable,cgst_total=cgst,sgst_total=sgst,igst_total=igst,grand_total=taxable+cgst+sgst+igst,tax_snapshot={'items':snap},issued_by=request.user,issued_at=now,pdf=b'',**data)
        invoice.pdf=invoice_pdf(invoice);invoice.save();InvoiceAudit.objects.create(invoice=invoice,actor=request.user,action='INVOICE_ISSUED',snapshot={'invoice_number':number,'order_number':order.order_number,'kind':invoice.kind,'totals':{'taxable':str(taxable),'cgst':str(cgst),'sgst':str(sgst),'igst':str(igst),'grand':str(invoice.grand_total)},'items':snap});audit(order,request.user,'INVOICE_ISSUED');return Response(OrderSerializer(records().get(pk=pk)).data,status=201)

class InvoiceDownload(APIView):
    def get(self,request,pk):
        if not request.user.is_authenticated: raise PermissionDenied('Authentication required.')
        order=get_object_or_404(records(),pk=pk)
        staff_allowed=request.user.account_type==AccountType.STAFF and StaffRoleAssignment.objects.filter(staff_account=request.user,revoked_at__isnull=True,role__permissions__code='READ_REPORTS').exists()
        allowed=order.buyer_id==request.user.pk or order.business.account_id==request.user.pk or staff_allowed
        if not allowed: raise PermissionDenied('You cannot access this invoice.')
        try: invoice=order.invoice
        except Invoice.DoesNotExist: raise ValidationError('No invoice has been issued.')
        response=HttpResponse(bytes(invoice.pdf),content_type='application/pdf');response['Content-Disposition']=f'attachment; filename="{invoice.invoice_number.replace("/","-")}.pdf"';response['Cache-Control']='private, no-store';return response

class StaffOrders(APIView):
    permission_classes=[HasStaffPermission];required_staff_permission='READ_REPORTS'
    def get(self,request):
        qs=records(); query=request.query_params.get('q','').strip(); state=request.query_params.get('state','').strip().upper(); kind=request.query_params.get('invoice_kind','').strip().upper()
        if state and state not in Order.State.values: raise ValidationError({'state':'Choose a valid order state.'})
        if kind and kind not in Invoice.Kind.values: raise ValidationError({'invoice_kind':'Choose a valid invoice kind.'})
        if query: qs=qs.filter(Q(order_number__icontains=query)|Q(business__legal_name__icontains=query)|Q(branch__branch_name__icontains=query)|Q(invoice__invoice_number__icontains=query))
        if state: qs=qs.filter(state=state)
        if kind: qs=qs.filter(invoice__kind=kind)
        return page(request,qs)
class StaffOrderDetail(APIView):
    permission_classes=[HasStaffPermission];required_staff_permission='READ_REPORTS'
    def get(self,request,pk):
        order=get_object_or_404(records(),pk=pk);data=OrderSerializer(order).data;data['audit']=list(order.audit_events.values('id','action','actor_id','reason','occurred_at'));data['invoice_audit']=list(order.invoice.audit_events.values('id','action','actor_id','occurred_at')) if hasattr(order,'invoice') else [];return Response(data)
