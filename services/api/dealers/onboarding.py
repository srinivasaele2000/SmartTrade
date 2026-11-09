import hashlib
import json
import re
import unicodedata

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessProfile
from catalogue.models import Brand
from catalogue.serializers import StrictSerializer
from companies.permissions import HasStaffPermission
from config.india import INDIAN_MOBILE_PATTERN
from .models import BrandSuggestion, DealerAudit, DealerDeclarations, TradeWorkerContact
from .serializers import BusinessSerializer
from .views import IsBusiness, audit, business, page


MINIMUM_CONTACTS = 10
CATEGORIES = {
    'Electrical': ('Electrical',),
    'Plumbing': ('Plumbing',),
    'Cement': ('Cement',),
    'Iron/Steel': ('Iron/Steel', 'Iron & Steel', 'Iron and Steel'),
    'Hardware': ('Hardware',),
    'Paints': ('Paints',),
    'Construction materials': ('Construction materials',),
    'Other': (),
}


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def identifier(value):
    return re.sub(r'[\W_]+', '', normalized(value))


class PrivateView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response


class DealerView(PrivateView):
    permission_classes = [IsBusiness]

    def owner(self, request):
        return get_object_or_404(BusinessProfile, account=request.user)


class StaffView(PrivateView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'


class BrandOption(serializers.ModelSerializer):
    company_name = serializers.CharField(source='company.legal_name')

    class Meta:
        model = Brand
        fields = ['id', 'name', 'company_name']


def brand_options(categories=()):
    query = Brand.objects.filter(
        company__verification_state='VERIFIED', company__activity_state='ACTIVE',
        company__owner_account__access_state='ACTIVE',
    ).select_related('company').order_by('name', 'pk')
    if not categories or 'Other' in categories:
        return query
    condition = Q()
    for label in categories:
        for name in CATEGORIES[label]:
            condition |= Q(category_links__category__name__iexact=name)
    return query.filter(condition & Q(category_links__category__active=True)).distinct()


def declarations_data(dealer):
    current = DealerDeclarations.objects.filter(business=dealer).first()
    return {
        'category_options': list(CATEGORIES),
        'categories': current.categories if current else [],
        'brands': BrandOption(current.brands.select_related('company').order_by('name', 'pk'), many=True).data if current else [],
    }


class DeclarationInput(serializers.Serializer):
    categories = serializers.ListField(child=serializers.ChoiceField(choices=list(CATEGORIES)), max_length=len(CATEGORIES))
    brands = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=200)


class Declarations(DealerView):
    def get(self, request):
        return Response(declarations_data(self.owner(request)))

    @transaction.atomic
    def put(self, request):
        dealer = business(request)
        serializer = DeclarationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        categories = list(dict.fromkeys(serializer.validated_data['categories']))
        brands = set(serializer.validated_data['brands'])
        if brands and not categories:
            raise serializers.ValidationError({'categories': 'Select at least one dealer category.'})
        if set(brand_options(categories).filter(pk__in=brands).values_list('pk', flat=True)) != brands:
            raise serializers.ValidationError({'brands': 'Select existing brands for the chosen categories.'})
        record, _ = DealerDeclarations.objects.get_or_create(business=dealer)
        record.categories = categories
        record.save(update_fields=['categories'])
        record.brands.set(brands)
        audit(request, dealer, 'DECLARATIONS_UPDATED', {'categories': categories, 'brands': sorted(brands)})
        return Response(declarations_data(dealer))


class DeclarationBrands(DealerView):
    def get(self, request):
        categories = request.query_params.getlist('category')
        if set(categories) - CATEGORIES.keys():
            raise serializers.ValidationError({'category': 'Choose a supported dealer category.'})
        options = brand_options(categories)
        search = request.query_params.get('search', '').strip()
        if search:
            options = options.filter(Q(name__icontains=search) | Q(company__legal_name__icontains=search))
        return page(request, options, BrandOption)


class SuggestionSerializer(StrictSerializer):
    class Meta:
        model = BrandSuggestion
        fields = ['id', 'name', 'context', 'status', 'canonical_brand', 'created_at']
        read_only_fields = ['id', 'status', 'canonical_brand', 'created_at']


class Suggestions(DealerView):
    def get(self, request):
        return page(request, self.owner(request).brand_suggestions.order_by('-pk'), SuggestionSerializer)

    @transaction.atomic
    def post(self, request):
        dealer = business(request)
        serializer = SuggestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = normalized(serializer.validated_data['name'])
        if len(key) > 500:
            raise serializers.ValidationError({'name': 'Brand name is too long after normalization.'})
        try:
            with transaction.atomic():
                item = serializer.save(business=dealer, normalized_name=key)
        except IntegrityError:
            raise serializers.ValidationError({'name': 'A suggestion for this brand already exists.'})
        audit(request, dealer, 'BRAND_SUGGESTED', {'suggestion': item.pk})
        return Response(serializer.data, status=201)


class ContactSerializer(StrictSerializer):
    consent = serializers.BooleanField(write_only=True)
    consent_confirmed = serializers.BooleanField(read_only=True, default=True)
    consent_confirmed_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = TradeWorkerContact
        fields = ['id', 'name', 'mobile_e164', 'trade', 'location', 'consent', 'consent_confirmed', 'consent_confirmed_at']

    def validate_mobile_e164(self, value):
        if not INDIAN_MOBILE_PATTERN.fullmatch(value):
            raise serializers.ValidationError('Use an Indian mobile number in +91 format.')
        return value

    def validate(self, attrs):
        if attrs.pop('consent', False) is not True:
            raise serializers.ValidationError({'consent': 'Confirm permission from the contact before saving.'})
        attrs['consent_confirmed_at'] = timezone.now()
        return attrs


class Contacts(DealerView):
    def get(self, request):
        response = page(request, self.owner(request).trade_contacts.order_by('pk'), ContactSerializer)
        response.data['minimum_required'] = MINIMUM_CONTACTS
        return response

    @transaction.atomic
    def post(self, request):
        return self.save_contact(request, business(request))

    def save_contact(self, request, dealer, item=None):
        serializer = ContactSerializer(item, data=request.data, partial=item is not None)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                saved = serializer.save(business=dealer)
        except IntegrityError:
            raise serializers.ValidationError({'mobile_e164': 'This mobile number is already in your network.'})
        audit(request, dealer, 'CONTACT_CONSENT_CONFIRMED', {'contact': saved.pk})
        return Response(serializer.data, status=200 if item else 201)


class ContactDetail(Contacts):
    http_method_names = ['patch', 'delete', 'options']

    @transaction.atomic
    def patch(self, request, pk):
        dealer = business(request)
        return self.save_contact(request, dealer, get_object_or_404(dealer.trade_contacts, pk=pk))

    @transaction.atomic
    def delete(self, request, pk):
        dealer = business(request)
        get_object_or_404(dealer.trade_contacts, pk=pk).delete()
        audit(request, dealer, 'CONTACT_REMOVED', {'contact': pk})
        return Response(status=204)


class ReviewInput(serializers.Serializer):
    action = serializers.ChoiceField(choices=['APPROVED', 'REJECTED', 'MAPPED'])
    reason = serializers.CharField(max_length=1000)
    brand = serializers.PrimaryKeyRelatedField(queryset=Brand.objects.all(), required=False)

    def validate(self, attrs):
        if ('brand' in attrs) != (attrs['action'] == 'MAPPED'):
            raise serializers.ValidationError({'brand': 'A canonical brand is required only when mapping.'})
        return attrs


class StaffSuggestionReview(StaffView):
    @transaction.atomic
    def post(self, request, pk, suggestion_id):
        dealer = get_object_or_404(BusinessProfile.objects.select_for_update(), pk=pk)
        item = get_object_or_404(dealer.brand_suggestions, pk=suggestion_id)
        if item.status != 'PENDING':
            return Response({'detail': 'This suggestion has already been reviewed.'}, status=409)
        serializer = ReviewInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        item.status = data['action']
        item.canonical_brand = data.get('brand')
        item.save(update_fields=['status', 'canonical_brand'])
        audit(request, dealer, 'BRAND_SUGGESTION_REVIEWED', {
            'suggestion': item.pk, 'status': item.status, 'canonical_brand': item.canonical_brand_id,
        }, reason=data['reason'])
        return Response(SuggestionSerializer(item).data)


def identity(item):
    return {
        'GSTIN': identifier(item.gstin),
        'registration': identifier(item.registration_number),
        'name': identifier(item.legal_name),
        'address': identifier(item.registered_address),
        'pin': item.registered_pin_code,
    }


def match_candidates(dealer):
    source = identity(dealer)
    if not (source['GSTIN'] or source['registration'] or (source['name'] and source['address'] and source['pin'])):
        return []
    decisions = {}
    for row in DealerAudit.objects.filter(business=dealer, action='DUPLICATE_REVIEWED').order_by('-pk'):
        decisions.setdefault(row.snapshot['fingerprint'], row)
    matches = []
    for other in BusinessProfile.objects.exclude(pk=dealer.pk).only(
        'id', 'gstin', 'registration_number', 'legal_name', 'registered_address', 'registered_pin_code',
    ).order_by('pk').iterator():
        target = identity(other)
        signals = [key for key in ('GSTIN', 'registration') if source[key] and source[key] == target[key]]
        if all(source[key] and source[key] == target[key] for key in ('name', 'address', 'pin')):
            signals.append('name and registered address')
        if not signals:
            continue
        fingerprint = hashlib.sha256(json.dumps([other.pk, source, target], sort_keys=True).encode()).hexdigest()
        decision = decisions.get(fingerprint)
        matches.append({
            'business': other.pk, 'signals': signals, 'fingerprint': fingerprint,
            'decision': None if decision is None else {
                'outcome': decision.snapshot['outcome'], 'reason': decision.reason, 'at': decision.occurred_at,
            },
        })
    return matches


class StaffOnboarding(StaffView):
    def get(self, request, pk):
        dealer = get_object_or_404(BusinessProfile, pk=pk)
        reviews = DealerAudit.objects.filter(business=dealer, action__in=['BRAND_SUGGESTION_REVIEWED', 'DUPLICATE_REVIEWED']).order_by('-pk')[:50]
        return Response({
            'profile': BusinessSerializer(dealer).data,
            'declarations': declarations_data(dealer),
            'suggestions': SuggestionSerializer(dealer.brand_suggestions.order_by('-pk'), many=True).data,
            'duplicates': match_candidates(dealer),
            'reviews': [{'action': row.action, 'actor': row.actor_id, 'reason': row.reason,
                         'snapshot': row.snapshot, 'at': row.occurred_at} for row in reviews],
        })


class DuplicateInput(serializers.Serializer):
    fingerprint = serializers.RegexField(r'^[0-9a-f]{64}$')
    outcome = serializers.ChoiceField(choices=['DISTINCT', 'NEEDS_FOLLOW_UP'])
    reason = serializers.CharField(max_length=1000)


class StaffDuplicateReview(StaffView):
    @transaction.atomic
    def post(self, request, pk):
        dealer = get_object_or_404(BusinessProfile.objects.select_for_update(), pk=pk)
        serializer = DuplicateInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        match = next((item for item in match_candidates(dealer) if item['fingerprint'] == data['fingerprint']), None)
        if not match:
            return Response({'detail': 'The match changed. Refresh the review.'}, status=409)
        audit(request, dealer, 'DUPLICATE_REVIEWED', {
            'fingerprint': match['fingerprint'], 'business': match['business'],
            'signals': match['signals'], 'outcome': data['outcome'],
        }, reason=data['reason'])
        return Response({'status': 'recorded'})


class StaffContacts(StaffView):
    required_staff_permission = 'REVIEW_TRADE_CONTACTS'

    def get(self, request, pk):
        dealer = get_object_or_404(BusinessProfile, pk=pk)
        audit(request, dealer, 'CONTACTS_REVIEWED', {})
        return page(request, dealer.trade_contacts.order_by('pk'), ContactSerializer)
