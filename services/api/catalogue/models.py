from django.conf import settings
from django.db import models
from django.db.models import Q


class Category(models.Model):
    name = models.CharField(max_length=120, unique=True)
    active = models.BooleanField(default=True)


class Brand(models.Model):
    company = models.ForeignKey('companies.CompanyProfile', on_delete=models.PROTECT, related_name='brands')
    name = models.CharField(max_length=160)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['company', 'name'], name='catalogue_brand_company_name')]


class BrandCategory(models.Model):
    brand = models.ForeignKey(Brand, on_delete=models.PROTECT, related_name='category_links')
    category = models.ForeignKey(Category, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['brand', 'category'], name='catalogue_brand_category_unique')]


class Product(models.Model):
    # A single FK to the association makes unsupported brand/category pairs impossible.
    brand_category = models.ForeignKey(BrandCategory, on_delete=models.PROTECT, related_name='products')
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    specifications = models.JSONField(default=dict, blank=True)
    unit = models.CharField(max_length=40)
    catalogue_price = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True)
    state = models.CharField(max_length=10, choices=[(s, s) for s in ('DRAFT', 'PUBLISHED', 'ARCHIVED')], default='DRAFT')
    moderation_state = models.CharField(max_length=9, choices=[(s, s) for s in ('VISIBLE', 'HIDDEN', 'SUSPENDED')], default='VISIBLE')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['brand_category', 'code'], name='catalogue_product_code'),
            models.CheckConstraint(condition=Q(state__in=['DRAFT', 'PUBLISHED', 'ARCHIVED']), name='catalogue_product_state'),
            models.CheckConstraint(condition=Q(moderation_state__in=['VISIBLE', 'HIDDEN', 'SUSPENDED']), name='catalogue_moderation_state'),
            models.CheckConstraint(condition=Q(catalogue_price__isnull=True, currency='') | Q(catalogue_price__isnull=False, catalogue_price__gte=0, currency='INR'), name='catalogue_price_currency_pair'),
        ]


class ProductMedia(models.Model):
    class Kind(models.TextChoices):
        IMAGE = 'image', 'Primary image'
        PDF = 'catalogue-pdf', 'Catalogue PDF'

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='official_media')
    kind = models.CharField(max_length=13, choices=Kind.choices)
    key = models.UUIDField(unique=True, editable=False)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=32)
    size = models.PositiveIntegerField()
    uploaded_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['product', 'kind'], name='catalogue_unique_media_kind'),
        ]

    @property
    def storage_name(self):
        extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf'}
        return f'catalogue/{self.key}.{extension[self.content_type]}'


class ProductVariant(models.Model):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='variants')
    sku = models.CharField(max_length=100)
    name = models.CharField(max_length=160)
    attributes = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['product', 'sku'], name='catalogue_variant_product_sku')]


class CatalogueAudit(models.Model):
    company = models.ForeignKey('companies.CompanyProfile', null=True, on_delete=models.PROTECT)
    brand = models.ForeignKey(Brand, null=True, on_delete=models.PROTECT)
    product = models.ForeignKey(Product, null=True, on_delete=models.PROTECT)
    variant = models.ForeignKey(ProductVariant, null=True, on_delete=models.PROTECT)
    category = models.ForeignKey(Category, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=64)
    reason = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(auto_now_add=True)
