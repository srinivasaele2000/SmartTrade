from django.conf import settings
from django.db import models
from django.db.models import Q
from config.india import INDIAN_STATES_AND_UTS


class DealerCustomItem(models.Model):
    dealer = models.ForeignKey('accounts.BusinessProfile', related_name='custom_items', on_delete=models.CASCADE)
    product_name = models.CharField(max_length=200)
    product_code = models.CharField(max_length=64, blank=True, default='')
    hsn_sac_code = models.CharField(max_length=32, blank=True, default='')
    list_price_per_unit = models.DecimalField(max_digits=12, decimal_places=2)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(list_price_per_unit__gte=0), name='dealer_custom_item_nonnegative_price')]


class DealerBanner(models.Model):
    TARGETS = [(value, value) for value in ('none', 'brand', 'category', 'item', 'support_chat')]
    TYPES = [('image', 'Image'), ('text', 'Text')]
    THEMES = [(value, value) for value in ('emerald', 'indigo', 'amber', 'slate', 'crimson')]
    title = models.CharField(max_length=140, blank=True)
    subtitle = models.CharField(max_length=240, blank=True)
    image = models.ImageField(upload_to='dealer_banners/%Y/%m/', null=True, blank=True)
    image_mime = models.CharField(max_length=32, blank=True)
    banner_type = models.CharField(max_length=16, choices=TYPES, default='image')
    theme_preset = models.CharField(max_length=32, choices=THEMES, default='emerald')
    badge_text = models.CharField(max_length=40, blank=True, default='')
    target_type = models.CharField(max_length=24, choices=TARGETS, default='none')
    target_brand = models.ForeignKey('catalogue.Brand', null=True, blank=True, on_delete=models.SET_NULL)
    target_category = models.ForeignKey('catalogue.Category', null=True, blank=True, on_delete=models.SET_NULL)
    target_item = models.ForeignKey('catalogue.Product', null=True, blank=True, on_delete=models.SET_NULL)
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ('sort_order', '-created_at', '-pk')


class AdminSupportThread(models.Model):
    dealer = models.OneToOneField('accounts.BusinessProfile', on_delete=models.PROTECT, related_name='support_thread')
    last_message_at = models.DateTimeField(null=True, db_index=True)
    last_message_preview = models.CharField(max_length=255, blank=True)
    dealer_unread_count = models.PositiveIntegerField(default=0)
    admin_unread_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class AdminSupportMessage(models.Model):
    thread = models.ForeignKey(AdminSupportThread, related_name='messages', on_delete=models.CASCADE)
    sender_role = models.CharField(max_length=6, choices=[('dealer', 'Dealer'), ('admin', 'Admin')])
    sender_user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    body = models.TextField(blank=True)
    attachment = models.FileField(upload_to='support_messages/%Y/%m/', blank=True)
    attachment_type = models.CharField(max_length=16, blank=True)
    attachment_mime = models.CharField(max_length=32, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_size = models.PositiveIntegerField(null=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)


class DealerLocation(models.Model):
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.PROTECT, related_name='locations')
    branch_name = models.CharField(max_length=160)
    address = models.CharField(max_length=400)
    pin_code = models.CharField(max_length=20, db_index=True)
    locality = models.CharField(max_length=120, db_index=True)
    district = models.CharField(max_length=120, db_index=True)
    state = models.CharField(max_length=120)
    country = models.CharField(max_length=2, default='IN')
    latitude = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True)
    longitude = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True)
    contact_name = models.CharField(max_length=160, blank=True)
    contact_phone = models.CharField(max_length=16, blank=True)
    contact_email = models.EmailField(blank=True)
    active = models.BooleanField(default=True)
    admin_hidden = models.BooleanField(default=False)
    visibility_state = models.CharField(max_length=13, choices=[('PRIVATE_DRAFT', 'Private draft'), ('VISIBLE', 'Visible')], default='PRIVATE_DRAFT')

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(visibility_state__in=['PRIVATE_DRAFT', 'VISIBLE']), name='dealer_location_visibility'),
            models.CheckConstraint(condition=Q(pin_code__regex=r'^[1-9][0-9]{5}$'), name='dealer_location_indian_pin'),
            models.CheckConstraint(condition=Q(country='IN'), name='dealer_location_india_only'),
            models.CheckConstraint(condition=Q(state__in=INDIAN_STATES_AND_UTS), name='dealer_location_indian_state'),
            models.CheckConstraint(condition=Q(contact_phone='') | Q(contact_phone__regex=r'^\+91[6-9][0-9]{9}$'), name='dealer_location_indian_phone'),
        ]


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
            models.CheckConstraint(condition=Q(selling_price__gte=0, currency='INR'), name='dealer_listing_money'),
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


class DealerDeclarations(models.Model):
    business = models.OneToOneField('accounts.BusinessProfile', on_delete=models.CASCADE, related_name='declarations')
    categories = models.JSONField(default=list)
    brands = models.ManyToManyField('catalogue.Brand', blank=True)


class BrandSuggestion(models.Model):
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.CASCADE, related_name='brand_suggestions')
    name = models.CharField(max_length=160)
    normalized_name = models.CharField(max_length=500, editable=False)
    context = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, default='PENDING')
    canonical_brand = models.ForeignKey('catalogue.Brand', null=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'normalized_name'], name='dealer_unique_brand_suggestion'),
            models.CheckConstraint(
                condition=Q(status='MAPPED', canonical_brand__isnull=False)
                | Q(status__in=['PENDING', 'APPROVED', 'REJECTED'], canonical_brand__isnull=True),
                name='dealer_brand_suggestion_review_state',
            ),
        ]


class TradeWorkerContact(models.Model):
    business = models.ForeignKey('accounts.BusinessProfile', on_delete=models.CASCADE, related_name='trade_contacts')
    name = models.CharField(max_length=160)
    mobile_e164 = models.CharField(max_length=13)
    trade = models.CharField(max_length=120)
    location = models.CharField(max_length=200, blank=True)
    consent_confirmed_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['business', 'mobile_e164'], name='dealer_unique_trade_worker_mobile'),
            models.CheckConstraint(condition=Q(mobile_e164__regex=r'^\+91[6-9][0-9]{9}$'), name='dealer_trade_worker_indian_mobile'),
        ]
