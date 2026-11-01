import re
import unicodedata
from rest_framework import serializers
from accounts.models import BusinessProfile
from catalogue.serializers import StrictSerializer
from .models import DealerLocation, DealerProductListing, AuthorizedDealerGrant


class BusinessSerializer(StrictSerializer):
    class Meta:
        model = BusinessProfile
        fields = ['id', 'legal_name', 'registration_number', 'verification_state']
        read_only_fields = ['id', 'verification_state']


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
        if 'country' in attrs and not re.fullmatch('[A-Z]{2}', attrs['country']):
            raise serializers.ValidationError({'country': 'Use a two-letter country code.'})
        if attrs.get('contact_phone') and not re.fullmatch(r'\+[1-9][0-9]{1,14}', attrs['contact_phone']):
            raise serializers.ValidationError({'contact_phone': 'Use E.164 format.'})
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
        if not re.fullmatch('[A-Z]{3}', value('currency') or ''):
            raise serializers.ValidationError({'currency': 'Use an explicit uppercase three-letter currency code.'})
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

    class Meta(ListingSerializer.Meta):
        fields = ListingSerializer.Meta.fields + ['branch']

    def get_branch(self, item):
        location = item.location
        return {name: getattr(location, name) for name in ['id', 'branch_name', 'address', 'pin_code', 'locality', 'district', 'state', 'country']}
