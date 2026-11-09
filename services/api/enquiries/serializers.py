from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers

from dealers.models import DealerProductListing
from dealers.views import eligible_listings
from .models import Enquiry, EnquiryItem, QuotationItem, QuotationRevision


class EnquiryItemInputSerializer(serializers.Serializer):
    listing = serializers.PrimaryKeyRelatedField(queryset=DealerProductListing.objects.all())
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0.0001'))
    requirement = serializers.CharField(max_length=500, allow_blank=True, required=False, default='')


class EnquiryCreateSerializer(serializers.Serializer):
    branch = serializers.IntegerField(min_value=1)
    requirements = serializers.CharField(max_length=4000, allow_blank=True, required=False, default='')
    notes = serializers.CharField(max_length=4000, allow_blank=True, required=False, default='')
    items = EnquiryItemInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        listing_ids = [item['listing'].pk for item in attrs['items']]
        if len(listing_ids) != len(set(listing_ids)):
            raise serializers.ValidationError({'items': 'Each branch listing may appear only once.'})
        eligible = {item.pk: item for item in eligible_listings().filter(pk__in=listing_ids, location_id=attrs['branch'])}
        if set(listing_ids) != set(eligible):
            raise serializers.ValidationError({'items': 'Every item must be an eligible published listing at the selected branch.'})
        attrs['eligible_listings'] = eligible
        return attrs


class EnquiryItemSerializer(serializers.ModelSerializer):
    listing_id = serializers.IntegerField(read_only=True)
    product_id = serializers.IntegerField(source='listing.product_id', read_only=True)
    product_name = serializers.CharField(source='listing.product.name', read_only=True)
    product_code = serializers.CharField(source='listing.product.code', read_only=True)
    variant_id = serializers.IntegerField(source='listing.variant_id', read_only=True, allow_null=True)
    variant_sku = serializers.CharField(source='listing.variant.sku', read_only=True, allow_null=True)
    variant_name = serializers.CharField(source='listing.variant.name', read_only=True, allow_null=True)

    class Meta:
        model = EnquiryItem
        fields = ['id', 'listing_id', 'product_id', 'product_name', 'product_code', 'variant_id', 'variant_sku', 'variant_name', 'quantity', 'requirement']


class QuotationItemSerializer(serializers.ModelSerializer):
    enquiry_item_id = serializers.IntegerField(read_only=True)
    product_name = serializers.CharField(source='enquiry_item.listing.product.name', read_only=True)
    variant_sku = serializers.CharField(source='enquiry_item.listing.variant.sku', read_only=True, allow_null=True)
    line_total = serializers.SerializerMethodField()

    def get_line_total(self, item):
        return f'{item.quantity * item.unit_price:.4f}'

    class Meta:
        model = QuotationItem
        fields = ['id', 'enquiry_item_id', 'product_name', 'variant_sku', 'quantity', 'unit_price', 'currency', 'notes', 'line_total']


class QuotationSerializer(serializers.ModelSerializer):
    items = QuotationItemSerializer(many=True, read_only=True)
    total = serializers.SerializerMethodField()
    effective_state = serializers.SerializerMethodField()

    def get_total(self, quotation):
        return f'{sum((item.quantity * item.unit_price for item in quotation.items.all()), Decimal("0")):.4f}'

    def get_effective_state(self, quotation):
        if quotation.state == QuotationRevision.State.SENT and quotation.valid_until <= timezone.now():
            return 'EXPIRED'
        return quotation.state

    class Meta:
        model = QuotationRevision
        fields = ['id', 'revision', 'state', 'effective_state', 'valid_until', 'dealer_notes', 'created_at', 'responded_at', 'items', 'total']


class EnquirySerializer(serializers.ModelSerializer):
    branch_id = serializers.IntegerField(read_only=True)
    branch_name = serializers.CharField(source='branch.branch_name', read_only=True)
    dealer_business_id = serializers.IntegerField(source='branch.business_id', read_only=True)
    dealer_business_name = serializers.CharField(source='branch.business.legal_name', read_only=True)
    items = EnquiryItemSerializer(many=True, read_only=True)
    quotations = QuotationSerializer(many=True, read_only=True)

    class Meta:
        model = Enquiry
        fields = ['id', 'buyer_id', 'branch_id', 'branch_name', 'dealer_business_id', 'dealer_business_name', 'requirements', 'notes', 'state', 'created_at', 'updated_at', 'items', 'quotations']


class QuotationItemInputSerializer(serializers.Serializer):
    enquiry_item = serializers.PrimaryKeyRelatedField(queryset=EnquiryItem.objects.all())
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0.0001'))
    unit_price = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0'))
    currency = serializers.CharField(default='INR')
    notes = serializers.CharField(max_length=500, allow_blank=True, required=False, default='')

    def validate_currency(self, value):
        if value != 'INR':
            raise serializers.ValidationError('SmartTrade quotations support INR only.')
        return value


class QuotationCreateSerializer(serializers.Serializer):
    valid_until = serializers.DateTimeField()
    dealer_notes = serializers.CharField(max_length=4000, allow_blank=True, required=False, default='')
    items = QuotationItemInputSerializer(many=True, allow_empty=False)

    def validate_valid_until(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('Quotation validity must be in the future.')
        return value

    def validate(self, attrs):
        enquiry = self.context['enquiry']
        received = [item['enquiry_item'].pk for item in attrs['items']]
        expected = list(enquiry.items.values_list('pk', flat=True))
        if len(received) != len(set(received)) or set(received) != set(expected):
            raise serializers.ValidationError({'items': 'Quote every enquiry item exactly once.'})
        if any(item['enquiry_item'].enquiry_id != enquiry.pk for item in attrs['items']):
            raise serializers.ValidationError({'items': 'Quotation item belongs to another enquiry.'})
        return attrs


class BuyerResponseSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['ACCEPT', 'REJECT'])
    reason = serializers.CharField(max_length=4000, allow_blank=True, required=False, default='')

    def validate(self, attrs):
        if attrs['action'] == 'REJECT' and not attrs['reason'].strip():
            raise serializers.ValidationError({'reason': 'A rejection reason is required.'})
        return attrs


class DeclineSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=4000, allow_blank=False)
