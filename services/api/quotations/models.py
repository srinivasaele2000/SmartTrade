from decimal import Decimal, ROUND_HALF_UP

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
    class DiscountMode(models.TextChoices):
        PERCENT = 'PERCENT', 'Percent'
        AMOUNT = 'AMOUNT', 'Amount per unit'

    estimate = models.ForeignKey(Estimate, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey('catalogue.Product', on_delete=models.PROTECT, null=True, blank=True)
    dealer_custom_item = models.ForeignKey('dealers.DealerCustomItem', on_delete=models.PROTECT, null=True, blank=True)
    product_name = models.CharField(max_length=200)
    product_code = models.CharField(max_length=100, blank=True, default='')
    hsn_sac_code = models.CharField(max_length=32, blank=True)
    list_price_per_unit = models.DecimalField(max_digits=18, decimal_places=4, null=True)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    quantity = models.DecimalField(max_digits=9, decimal_places=3)
    discount_mode = models.CharField(max_length=7, choices=DiscountMode.choices, default=DiscountMode.PERCENT)
    discount_value = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=24, decimal_places=2)

    @property
    def net_unit_rate(self):
        if not self.discount_value:
            return self.unit_price
        rate = (self.unit_price - self.discount_value if self.discount_mode == self.DiscountMode.AMOUNT
                else self.unit_price * (100 - self.discount_value) / 100)
        return rate.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    class Meta:
        ordering = ('pk',)
        constraints = [
            models.UniqueConstraint(fields=['estimate', 'product'], name='estimate_unique_product'),
            models.UniqueConstraint(fields=['estimate', 'dealer_custom_item'], name='estimate_unique_general_item'),
            models.CheckConstraint(condition=(
                models.Q(product__isnull=False, dealer_custom_item__isnull=True)
                | models.Q(product__isnull=True, dealer_custom_item__isnull=False)
            ), name='estimate_line_one_item_source'),
        ]


class Bill(models.Model):
    estimate = models.OneToOneField(Estimate, related_name='bill', on_delete=models.PROTECT)
    bill_number = models.CharField(max_length=40, unique=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    snapshot = models.JSONField()
    payment_status = models.CharField(max_length=6, choices=[('UNPAID', 'Unpaid'), ('PAID', 'Paid')], default='UNPAID')
