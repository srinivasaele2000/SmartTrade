from django.conf import settings
from django.db import models
from django.db.models import Q


class DealerLocation(models.Model):
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT, related_name='locations')
    branch_name = models.CharField(max_length=160)
    address = models.CharField(max_length=400)
    pin_code = models.CharField(max_length=20, db_index=True)
    locality = models.CharField(max_length=120, db_index=True)
    district = models.CharField(max_length=120, db_index=True)
    state = models.CharField(max_length=120)
    country = models.CharField(max_length=2)
    contact_name = models.CharField(max_length=160, blank=True)
    contact_phone = models.CharField(max_length=16, blank=True)
    contact_email = models.EmailField(blank=True)
    active = models.BooleanField(default=True)
    admin_hidden = models.BooleanField(default=False)
    visibility_state = models.CharField(max_length=13, choices=[('PRIVATE_DRAFT', 'Private draft'), ('VISIBLE', 'Visible')], default='PRIVATE_DRAFT')

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(visibility_state__in=['PRIVATE_DRAFT', 'VISIBLE']), name='dealer_location_visibility')]


class AuthorizedDealerGrant(models.Model):
    company = models.ForeignKey('companies.CompanyProfile', on_delete=models.PROTECT)
    brand = models.ForeignKey('catalogue.Brand', on_delete=models.PROTECT)
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT, related_name='dealer_grants')
    active = models.BooleanField(default=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'brand', 'business'], name='dealer_grant_scope')]


class DealerProductListing(models.Model):
    location = models.ForeignKey(DealerLocation, on_delete=models.PROTECT, related_name='listings')
    product = models.ForeignKey('catalogue.Product', on_delete=models.PROTECT)
    variant = models.ForeignKey('catalogue.ProductVariant', null=True, blank=True, on_delete=models.PROTECT)
    selling_price = models.DecimalField(max_digits=18, decimal_places=4)
    currency = models.CharField(max_length=3)
    stock_status = models.CharField(max_length=12, choices=[(s, s) for s in ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']], default='UNKNOWN', db_index=True)
    quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    state = models.CharField(max_length=9, choices=[('PUBLISHED', 'Published'), ('WITHDRAWN', 'Withdrawn')], default='WITHDRAWN')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['location', 'product'], condition=Q(variant__isnull=True), name='dealer_listing_without_variant'),
            models.UniqueConstraint(fields=['location', 'product', 'variant'], condition=Q(variant__isnull=False), name='dealer_listing_with_variant'),
            models.CheckConstraint(condition=Q(selling_price__gte=0, currency__regex=r'^[A-Z]{3}$'), name='dealer_listing_money'),
            models.CheckConstraint(condition=Q(quantity__isnull=True) | Q(quantity__gte=0), name='dealer_listing_quantity'),
            models.CheckConstraint(condition=Q(state__in=['PUBLISHED', 'WITHDRAWN']), name='dealer_listing_state'),
            models.CheckConstraint(condition=Q(stock_status__in=['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']), name='dealer_listing_stock'),
            models.CheckConstraint(condition=Q(quantity__isnull=True) | Q(stock_status='IN_STOCK', quantity__gt=0) | Q(stock_status='OUT_OF_STOCK', quantity=0), name='dealer_listing_stock_quantity'),
        ]
        indexes = [models.Index(fields=['product', 'stock_status'])]


class DealerAudit(models.Model):
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT)
    location = models.ForeignKey(DealerLocation, null=True, on_delete=models.PROTECT)
    listing = models.ForeignKey(DealerProductListing, null=True, on_delete=models.PROTECT)
    grant = models.ForeignKey(AuthorizedDealerGrant, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=64)
    reason = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(auto_now_add=True)
