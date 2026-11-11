import re
import unicodedata
from rest_framework import serializers
from accounts.models import BusinessProfile
from accounts.profiles import validate_profile_location
from catalogue.serializers import StrictSerializer
from catalogue.media import attachment, media_url
from catalogue.taxonomy import SUB_CATEGORIES
from .models import DealerLocation, DealerProductListing, AuthorizedDealerGrant
from config.india import GSTIN_PATTERN, INDIAN_MOBILE_PATTERN, INDIAN_PIN_PATTERN, PAN_PATTERN, canonical_indian_state


BUSINESS_SUMMARY_FIELDS = ('id', 'legal_name', 'registration_number', 'gstin', 'pan', 'verification_state')


class BusinessSerializer(StrictSerializer):
    class Meta:
        model = BusinessProfile
        fields = BUSINESS_SUMMARY_FIELDS + (
            'owner_name', 'business_email', 'registered_address', 'registered_pin_code',
            'registered_locality', 'registered_district', 'registered_state',
            'business_type', 'sub_category', 'trade_license', 'contacts_submitted_at',
        )
        read_only_fields = ['id', 'verification_state', 'business_type', 'contacts_submitted_at']

    def validate(self, attrs):
        sub_category = attrs.get('sub_category')
        if sub_category and sub_category not in SUB_CATEGORIES.get(getattr(self.instance, 'business_type', None), ()):
            raise serializers.ValidationError({'sub_category': 'Choose a sub-business for the registered business type.'})
        return validate_profile_location(attrs, 'registered_')

    def validate_gstin(self, value):
        value = value.strip().upper()
        if value and not GSTIN_PATTERN.fullmatch(value):
            raise serializers.ValidationError('Use a valid 15-character GSTIN.')
        return value

    def validate_pan(self, value):
        value = value.strip().upper()
        if value and not PAN_PATTERN.fullmatch(value):
            raise serializers.ValidationError('Use a valid 10-character PAN.')
        return value


class BusinessSummarySerializer(BusinessSerializer):
    class Meta(BusinessSerializer.Meta):
        fields = BUSINESS_SUMMARY_FIELDS


class LocationSerializer(StrictSerializer):
    class Meta:
        model = DealerLocation
        fields = ['id', 'business', 'branch_name', 'address', 'pin_code', 'locality', 'district', 'state', 'country', 'contact_name', 'contact_phone', 'contact_email', 'active', 'admin_hidden', 'visibility_state']
        read_only_fields = ['id', 'business', 'admin_hidden']

    def validate(self, attrs):
        for field in ['pin_code', 'locality', 'district', 'state', 'country']:
            if field in attrs:
                value = ' '.join(unicodedata.normalize('NFKC', attrs[field]).split()).upper()
                if not value:
                    raise serializers.ValidationError({field: 'Required.'})
                attrs[field] = value
        if 'pin_code' in attrs:
            attrs['pin_code'] = ''.join(attrs['pin_code'].split())
            if not INDIAN_PIN_PATTERN.fullmatch(attrs['pin_code']):
                raise serializers.ValidationError({'pin_code': 'Use a six-digit Indian PIN code.'})
        if 'country' in attrs and attrs['country'] != 'IN':
            raise serializers.ValidationError({'country': 'SmartTrade currently supports India (IN) only.'})
        if 'state' in attrs:
            canonical = canonical_indian_state(attrs['state'])
            if canonical is None:
                raise serializers.ValidationError({'state': 'Choose a valid Indian state or union territory.'})
            attrs['state'] = canonical
        if attrs.get('contact_phone') and not INDIAN_MOBILE_PATTERN.fullmatch(attrs['contact_phone']):
            raise serializers.ValidationError({'contact_phone': 'Use a valid Indian mobile number in +91XXXXXXXXXX format.'})
        return attrs


class ListingSerializer(StrictSerializer):
    company_name = serializers.CharField(source='product.brand_category.brand.company.legal_name', read_only=True)
    product_code = serializers.CharField(source='product.code', read_only=True)
    variant_sku = serializers.CharField(source='variant.sku', read_only=True, allow_null=True)
    variant_name = serializers.CharField(source='variant.name', read_only=True, allow_null=True)
    eligible = serializers.SerializerMethodField()

    def get_eligible(self, listing):
        if hasattr(listing, 'currently_eligible'):
            return listing.currently_eligible
        from .views import eligible_listings
        return eligible_listings().filter(pk=listing.pk).exists()

    business_name = serializers.CharField(source='location.business.legal_name', read_only=True)
    brand_id = serializers.IntegerField(source='product.brand_category.brand_id', read_only=True)
    company_id = serializers.IntegerField(source='product.brand_category.brand.company_id', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    brand_name = serializers.CharField(source='product.brand_category.brand.name', read_only=True)
    company_catalogue_price = serializers.DecimalField(source='product.catalogue_price', max_digits=18, decimal_places=4, read_only=True)
    company_catalogue_currency = serializers.CharField(source='product.currency', read_only=True)
    branch_name = serializers.CharField(source='location.branch_name', read_only=True)
    business_id = serializers.IntegerField(source='location.business_id', read_only=True)

    class Meta:
        model = DealerProductListing
        fields = ['id', 'company_name', 'product_code', 'variant_sku', 'variant_name', 'eligible', 'business_id', 'business_name', 'location', 'branch_name', 'product', 'product_name', 'brand_id', 'brand_name', 'company_id', 'variant', 'selling_price', 'currency', 'stock_status', 'quantity', 'state', 'updated_at', 'company_catalogue_price', 'company_catalogue_currency']
        read_only_fields = ['id', 'updated_at']

    def validate(self, attrs):
        old = self.instance
        value = lambda name: attrs.get(name, getattr(old, name, None))
        if old and any(name in attrs and attrs[name] != getattr(old, name) for name in ['location', 'product', 'variant']):
            raise serializers.ValidationError('Listing branch, product and variant are immutable; withdraw and use another listing.')
        if value('variant') and value('variant').product_id != value('product').pk:
            raise serializers.ValidationError({'variant': 'Variant must belong to the selected product.'})
        if value('selling_price') is not None and value('selling_price') < 0:
            raise serializers.ValidationError({'selling_price': 'Must be nonnegative.'})
        if value('currency') != 'INR':
            raise serializers.ValidationError({'currency': 'SmartTrade currently supports INR only.'})
        qty, stock = value('quantity'), value('stock_status') or 'UNKNOWN'
        if qty is not None and (qty < 0 or stock == 'UNKNOWN' or (stock == 'IN_STOCK' and qty <= 0) or (stock == 'OUT_OF_STOCK' and qty != 0)):
            raise serializers.ValidationError({'quantity': 'Quantity must agree with stock status: positive for IN_STOCK, zero for OUT_OF_STOCK, omitted for UNKNOWN.'})
        return attrs


class GrantSerializer(StrictSerializer):
    company_name = serializers.CharField(source='company.legal_name', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    business_name = serializers.CharField(source='business.legal_name', read_only=True)
    business_verification_state = serializers.CharField(source='business.verification_state', read_only=True)
    company_verification_state = serializers.CharField(source='company.verification_state', read_only=True)
    company_activity_state = serializers.CharField(source='company.activity_state', read_only=True)
    eligible = serializers.SerializerMethodField()

    def get_eligible(self, grant):
        return grant.active and grant.business.verification_state == 'VERIFIED' and grant.business.account.is_active and grant.company.can_publish_catalogue

    class Meta:
        model = AuthorizedDealerGrant
        fields = ['id', 'company', 'brand', 'business', 'active', 'actor', 'reason', 'updated_at', 'company_name', 'brand_name', 'business_name', 'business_verification_state', 'company_verification_state', 'company_activity_state', 'eligible']
        read_only_fields = ['id', 'company', 'actor', 'updated_at']


class DiscoverySerializer(ListingSerializer):
    # Address and branch identity are discoverable; owner contact fields are deliberately absent.
    branch = serializers.SerializerMethodField()
    primary_image_url = serializers.SerializerMethodField()
    catalogue_pdf_url = serializers.SerializerMethodField()

    class Meta(ListingSerializer.Meta):
        fields = ListingSerializer.Meta.fields + ['branch', 'primary_image_url', 'catalogue_pdf_url']

    def get_primary_image_url(self, item):
        return media_url(self.context.get('request'), attachment(item.product, 'image'))

    def get_catalogue_pdf_url(self, item):
        return media_url(self.context.get('request'), attachment(item.product, 'catalogue-pdf'))

    def get_branch(self, item):
        location = item.location
        return {name: getattr(location, name) for name in ['id', 'branch_name', 'address', 'pin_code', 'locality', 'district', 'state', 'country']}
