from decimal import Decimal, ROUND_HALF_UP
from rest_framework import serializers
from config.india import GSTIN_PATTERN, INDIAN_STATES_AND_UTS
from .models import Invoice, Order


class OrderItemSerializer(serializers.Serializer):
    id=serializers.IntegerField(); product_id=serializers.IntegerField(source='product_id_snapshot'); product_name=serializers.CharField(); product_code=serializers.CharField(); variant_id=serializers.IntegerField(source='variant_id_snapshot',allow_null=True); variant_sku=serializers.CharField(); quantity=serializers.DecimalField(max_digits=18,decimal_places=4); unit_price=serializers.DecimalField(max_digits=18,decimal_places=4); currency=serializers.CharField(); line_total=serializers.SerializerMethodField()
    def get_line_total(self,obj): return f'{obj.quantity*obj.unit_price:.4f}'

class InvoiceSerializer(serializers.ModelSerializer):
    download_url=serializers.SerializerMethodField()
    class Meta:
        model=Invoice
        exclude=['pdf','tax_snapshot']
    def get_download_url(self,obj): return f'/api/v1/orders/{obj.order_id}/invoice/download'

class OrderSerializer(serializers.ModelSerializer):
    items=OrderItemSerializer(many=True,read_only=True); branch_name=serializers.CharField(source='branch.branch_name',read_only=True); dealer_business_name=serializers.CharField(source='business.legal_name',read_only=True); invoice=serializers.SerializerMethodField(); total=serializers.SerializerMethodField()
    def get_invoice(self,obj):
        try:return InvoiceSerializer(obj.invoice).data
        except Invoice.DoesNotExist:return None
    def get_total(self,obj): return f'{sum((x.quantity*x.unit_price for x in obj.items.all()),Decimal("0")):.4f}'
    class Meta:
        model=Order
        fields=['id','order_number','quotation_id','buyer_id','business_id','branch_id','branch_name','dealer_business_name','state','created_at','updated_at','confirmed_at','items','total','invoice']

class OrderCreateSerializer(serializers.Serializer): quotation=serializers.IntegerField(min_value=1)

class OrderActionSerializer(serializers.Serializer):
    action=serializers.ChoiceField(choices=['CONFIRM','REJECT','PROCESSING','READY','COMPLETE','CANCEL'])
    reason=serializers.CharField(max_length=2000,allow_blank=True,required=False,default='')
    def validate(self,data):
        if data['action'] in ['REJECT','CANCEL'] and not data['reason'].strip(): raise serializers.ValidationError({'reason':'A reason is required.'})
        return data

class InvoiceLineSerializer(serializers.Serializer):
    order_item=serializers.IntegerField(min_value=1)
    hsn=serializers.CharField(max_length=20,allow_blank=True)
    discount=serializers.DecimalField(max_digits=18,decimal_places=2,min_value=Decimal('0'),default=Decimal('0'))
    tax_rate=serializers.DecimalField(max_digits=5,decimal_places=2,min_value=Decimal('0'),max_value=Decimal('100'))
    tax_mode=serializers.ChoiceField(choices=['NONE','CGST_SGST','IGST'])

class InvoiceCreateSerializer(serializers.Serializer):
    kind=serializers.ChoiceField(choices=Invoice.Kind.choices)
    supply_basis=serializers.ChoiceField(choices=['REGISTERED_TAXABLE','COMPOSITION','EXEMPT','UNREGISTERED'])
    buyer_gstin=serializers.CharField(max_length=15,allow_blank=True,required=False,default='')
    place_of_supply=serializers.ChoiceField(choices=[(x,x) for x in INDIAN_STATES_AND_UTS])
    items=InvoiceLineSerializer(many=True,allow_empty=False)
    def validate_buyer_gstin(self,value):
        value=value.strip().upper()
        if value and not GSTIN_PATTERN.fullmatch(value): raise serializers.ValidationError('Use a valid GSTIN.')
        return value
    def validate(self,data):
        order=self.context['order']; rows=data['items']; expected=set(order.items.values_list('id',flat=True)); received=[x['order_item'] for x in rows]
        if len(received)!=len(set(received)) or set(received)!=expected: raise serializers.ValidationError({'items':'Configure every order item exactly once.'})
        supplier=order.business.gstin
        if data['kind']==Invoice.Kind.TAX_INVOICE:
            if data['supply_basis']!='REGISTERED_TAXABLE': raise serializers.ValidationError({'supply_basis':'A tax invoice requires explicit REGISTERED_TAXABLE status.'})
            if not supplier: raise serializers.ValidationError({'kind':'Supplier GSTIN is required for a tax invoice.'})
            if any(not x['hsn'].strip() or x['tax_mode']=='NONE' for x in rows): raise serializers.ValidationError({'items':'Tax invoices require HSN and an explicit GST tax mode for every item.'})
        else:
            if data['supply_basis']=='REGISTERED_TAXABLE': raise serializers.ValidationError({'supply_basis':'Choose the applicable bill-of-supply basis.'})
            if any(x['tax_rate']!=0 or x['tax_mode']!='NONE' for x in rows): raise serializers.ValidationError({'items':'A bill of supply cannot include GST amounts.'})
        for row in rows:
            item=order.items.get(pk=row['order_item']); gross=(item.quantity*item.unit_price).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
            if row['discount']>gross: raise serializers.ValidationError({'items':'Discount cannot exceed the item value.'})
            if row['tax_mode']=='NONE' and row['tax_rate']!=0: raise serializers.ValidationError({'items':'Tax rate must be zero when tax mode is NONE.'})
        return data
