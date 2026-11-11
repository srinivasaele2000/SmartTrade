from django.db import models


TOTAL_FIELDS = ('sub_total', 'discount_amount', 'taxable_amount', 'cgst_amount',
                'sgst_amount', 'igst_amount', 'total_amount')


class Estimate(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        SHARED = 'SHARED', 'Confirmed for sharing'
        CONVERTED_TO_BILL = 'CONVERTED_TO_BILL', 'Converted'
        CANCELLED = 'CANCELLED', 'Cancelled'

    dealer = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT)
    customer_name = models.CharField(max_length=200, blank=True)
    customer_mobile = models.CharField(max_length=16, blank=True)
    status = models.CharField(max_length=17, choices=Status.choices, default=Status.DRAFT)
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    gst_type = models.CharField(max_length=9, choices=[('CGST_SGST', 'CGST + SGST'), ('IGST', 'IGST')])
    gst_rate_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    sub_total = models.DecimalField(max_digits=26, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=26, decimal_places=2)
    taxable_amount = models.DecimalField(max_digits=26, decimal_places=2)
    cgst_amount = models.DecimalField(max_digits=26, decimal_places=2)
    sgst_amount = models.DecimalField(max_digits=26, decimal_places=2)
    igst_amount = models.DecimalField(max_digits=26, decimal_places=2)
    total_amount = models.DecimalField(max_digits=26, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def totals(self):
        return {field: str(getattr(self, field)) for field in TOTAL_FIELDS}


class EstimateLine(models.Model):
    estimate = models.ForeignKey(Estimate, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey('catalogue.Product', on_delete=models.PROTECT)
    product_name = models.CharField(max_length=200)
    hsn_sac_code = models.CharField(max_length=8, blank=True)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    quantity = models.DecimalField(max_digits=9, decimal_places=3)
    line_total = models.DecimalField(max_digits=24, decimal_places=2)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['estimate', 'product'], name='estimate_unique_product')]


class Bill(models.Model):
    estimate = models.OneToOneField(Estimate, related_name='bill', on_delete=models.PROTECT)
    bill_number = models.CharField(max_length=40, unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    snapshot = models.JSONField()
    payment_status = models.CharField(max_length=6, choices=[('UNPAID', 'Unpaid'), ('PAID', 'Paid')], default='UNPAID')
