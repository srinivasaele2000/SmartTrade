from django.conf import settings
from django.db import models
from django.db.models import Q


class Order(models.Model):
    class State(models.TextChoices):
        PENDING = 'PENDING', 'Pending dealer confirmation'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        REJECTED = 'REJECTED', 'Rejected'
        PROCESSING = 'PROCESSING', 'Processing'
        READY = 'READY', 'Ready'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'
    quotation = models.OneToOneField('enquiries.QuotationRevision', on_delete=models.PROTECT, related_name='order')
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='orders')
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT, related_name='orders')
    branch = models.ForeignKey('dealers.DealerLocation', on_delete=models.PROTECT, related_name='orders')
    order_number = models.CharField(max_length=32, unique=True)
    state = models.CharField(max_length=12, choices=State.choices, default=State.PENDING, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        constraints=[models.CheckConstraint(condition=Q(state__in=['PENDING','CONFIRMED','REJECTED','PROCESSING','READY','COMPLETED','CANCELLED']),name='order_valid_state')]


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name='items')
    quotation_item = models.OneToOneField('enquiries.QuotationItem', on_delete=models.PROTECT)
    product_id_snapshot = models.PositiveBigIntegerField()
    product_name = models.CharField(max_length=200)
    product_code = models.CharField(max_length=100)
    variant_id_snapshot = models.PositiveBigIntegerField(null=True, blank=True)
    variant_sku = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    currency = models.CharField(max_length=3, default='INR')
    class Meta:
        constraints=[models.CheckConstraint(condition=Q(quantity__gt=0,unit_price__gte=0,currency='INR'),name='order_item_inr_positive')]


class OrderAudit(models.Model):
    order=models.ForeignKey(Order,on_delete=models.PROTECT,related_name='audit_events')
    actor=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)
    action=models.CharField(max_length=64)
    reason=models.TextField(blank=True)
    snapshot=models.JSONField(default=dict)
    occurred_at=models.DateTimeField(auto_now_add=True)


class InvoiceSequence(models.Model):
    business=models.ForeignKey('accounts.BusinessProfile',on_delete=models.PROTECT)
    financial_year=models.CharField(max_length=7)
    next_value=models.PositiveIntegerField(default=1)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['business','financial_year'],name='invoice_sequence_supplier_fy')]


class Invoice(models.Model):
    class Kind(models.TextChoices):
        TAX_INVOICE='TAX_INVOICE','Tax invoice'
        BILL_OF_SUPPLY='BILL_OF_SUPPLY','Bill of supply'
    order=models.OneToOneField(Order,on_delete=models.PROTECT,related_name='invoice')
    invoice_number=models.CharField(max_length=48)
    financial_year=models.CharField(max_length=7)
    kind=models.CharField(max_length=16,choices=Kind.choices)
    supply_basis=models.CharField(max_length=20,blank=True)
    supplier_name=models.CharField(max_length=200)
    supplier_gstin=models.CharField(max_length=15,blank=True)
    buyer_gstin=models.CharField(max_length=15,blank=True)
    place_of_supply=models.CharField(max_length=120)
    subtotal=models.DecimalField(max_digits=18,decimal_places=2)
    discount_total=models.DecimalField(max_digits=18,decimal_places=2)
    taxable_total=models.DecimalField(max_digits=18,decimal_places=2)
    cgst_total=models.DecimalField(max_digits=18,decimal_places=2)
    sgst_total=models.DecimalField(max_digits=18,decimal_places=2)
    igst_total=models.DecimalField(max_digits=18,decimal_places=2)
    grand_total=models.DecimalField(max_digits=18,decimal_places=2)
    tax_snapshot=models.JSONField(default=dict)
    pdf=models.BinaryField()
    issued_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)
    issued_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['invoice_number'],name='invoice_number_unique'),models.CheckConstraint(condition=Q(kind__in=['TAX_INVOICE','BILL_OF_SUPPLY']),name='invoice_valid_kind')]


class InvoiceAudit(models.Model):
    invoice=models.ForeignKey(Invoice,on_delete=models.PROTECT,related_name='audit_events')
    actor=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)
    action=models.CharField(max_length=64)
    snapshot=models.JSONField(default=dict)
    occurred_at=models.DateTimeField(auto_now_add=True)
