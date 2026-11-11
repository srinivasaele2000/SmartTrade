from datetime import timezone as datetime_timezone

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from accounts.models import AccountType, BusinessProfile, BusinessType
from accounts.views import AccountRegistrationView
from catalogue.taxonomy import SUB_CATEGORIES
from companies.permissions import HasStaffPermission
from config.india import GSTIN_PATTERN, INDIAN_MOBILE_PATTERN
from .models import TradeWorkerContact
from .onboarding import ContactSerializer, DealerView, MINIMUM_CONTACTS, StaffContacts, StaffView
from .views import audit, business, page


class DealerRegistrationInput(serializers.Serializer):
    firm_name = serializers.CharField(max_length=200)
    gstin = serializers.CharField(max_length=15)
    mobile_number = serializers.RegexField(INDIAN_MOBILE_PATTERN, source='mobile_e164')
    business_type = serializers.ChoiceField(choices=BusinessType.choices)
    sub_category = serializers.CharField(max_length=40, required=False, allow_blank=True)
    trade_license = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate(self, attrs):
        sub_category = attrs.get('sub_category')
        if sub_category and sub_category not in SUB_CATEGORIES.get(attrs['business_type'], ()):
            raise serializers.ValidationError({'sub_category': 'Choose a sub-business for the selected business type.'})
        return attrs

    def validate_gstin(self, value):
        value = value.upper()
        if not GSTIN_PATTERN.fullmatch(value):
            raise serializers.ValidationError('Enter a valid GSTIN format.')
        return value


class DealerRegistration(AccountRegistrationView):
    serializer_class = DealerRegistrationInput

    def create_account(self, values):
        account = super().create_account({'mobile_e164': values['mobile_e164'], 'account_type': AccountType.BUSINESS})
        BusinessProfile.objects.filter(account=account).update(
            legal_name=values['firm_name'], gstin=values['gstin'], business_type=values['business_type'],
            sub_category=values.get('sub_category', ''), trade_license=values.get('trade_license', ''),
        )
        return account


class BatchInput(serializers.Serializer):
    contacts = ContactSerializer(many=True, min_length=MINIMUM_CONTACTS, max_length=MINIMUM_CONTACTS)

    def validate_contacts(self, contacts):
        if len({item['mobile_e164'] for item in contacts}) != len(contacts):
            raise serializers.ValidationError('Enter ten contacts with distinct mobile numbers.')
        return contacts


class BatchContacts(DealerView):
    @transaction.atomic
    def post(self, request):
        dealer = business(request)
        if dealer.contacts_submitted_at is not None:
            return Response({'detail': 'The onboarding contacts have already been submitted.'}, status=409)
        serializer = BatchInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        contacts = serializer.validated_data['contacts']
        existing = {item.mobile_e164: item for item in dealer.trade_contacts.all()}
        submitted = {item['mobile_e164']: item for item in contacts}
        if any(number not in submitted or any(
            getattr(item, field) != submitted[number].get(field, '') for field in ('name', 'trade', 'location')
        ) for number, item in existing.items()):
            return Response({'detail': 'Include existing contacts unchanged. Manage any edits in your contact list first.'}, status=409)
        now = timezone.now()
        TradeWorkerContact.objects.bulk_create([
            TradeWorkerContact(business=dealer, **{**item, 'consent_confirmed_at': now})
            for item in contacts if item['mobile_e164'] not in existing
        ])
        dealer.contacts_submitted_at = now
        dealer.save(update_fields=['contacts_submitted_at'])
        audit(request, dealer, 'ONBOARDING_CONTACTS_SUBMITTED', {'count': len(contacts)})
        return Response({'count': len(contacts), 'submitted_at': now}, status=201)


class DirectoryAddress(serializers.Serializer):
    line = serializers.CharField(source='registered_address')
    pincode = serializers.CharField(source='registered_pin_code')
    area = serializers.CharField(source='registered_locality')
    district = serializers.CharField(source='registered_district')
    state = serializers.CharField(source='registered_state')


class DirectoryItem(serializers.ModelSerializer):
    firm_name = serializers.CharField(source='legal_name')
    mobile_number = serializers.CharField(source='account.mobile_e164')
    contact_count = serializers.IntegerField()
    worker_contacts_count = serializers.IntegerField(source='contact_count')
    email = serializers.EmailField(source='business_email')
    address = DirectoryAddress(source='*')
    verification_status = serializers.CharField(source='verification_state')

    class Meta:
        model = BusinessProfile
        fields = ['id', 'firm_name', 'owner_name', 'mobile_number', 'email', 'gstin',
                  'trade_license', 'registration_number', 'business_type', 'sub_category',
                  'address', 'verification_state', 'verification_status', 'contact_count',
                  'worker_contacts_count', 'contacts_submitted_at']


def directory_dealers():
    return BusinessProfile.objects.select_related('account').annotate(
        contact_count=Count('trade_contacts'),
    ).order_by('pk')


class DealerDirectory(StaffView):
    def get(self, request):
        dealers = directory_dealers()
        business_type = request.query_params.get('business_type')
        if business_type:
            if business_type not in BusinessType.values:
                raise serializers.ValidationError({'business_type': 'Choose a supported dealer business type.'})
            dealers = dealers.filter(business_type=business_type)
        search = request.query_params.get('search', '').strip()
        if search:
            mobile = ''.join(search.split()).replace('-', '')
            dealers = dealers.filter(Q(legal_name__icontains=search) | Q(gstin__icontains=search) |
                                     Q(account__mobile_e164__icontains=mobile or search))
        return page(request, dealers, DirectoryItem)


class DirectoryWorker(serializers.ModelSerializer):
    mobile_number = serializers.CharField(source='mobile_e164')
    area = serializers.CharField(source='location')
    consent_obtained = serializers.SerializerMethodField()
    submitted_at = serializers.DateTimeField(source='consent_confirmed_at', default_timezone=datetime_timezone.utc)

    class Meta:
        model = TradeWorkerContact
        fields = ['id', 'name', 'mobile_number', 'trade', 'area', 'consent_obtained', 'submitted_at']

    def get_consent_obtained(self, item):
        return item.consent_confirmed_at is not None


class DealerDirectoryDetail(StaffView):
    def get(self, request, pk):
        dealer = get_object_or_404(directory_dealers(), pk=pk)
        payload = DirectoryItem(dealer).data
        if not HasStaffPermission().has_permission(request, StaffContacts):
            return Response({**payload, 'worker_contacts': None})
        contacts = DirectoryWorker(dealer.trade_contacts.order_by('pk'), many=True).data
        audit(request, dealer, 'CONTACTS_REVIEWED', {'count': len(contacts), 'source': 'dealer_directory'})
        return Response({**payload, 'worker_contacts_count': len(contacts), 'worker_contacts': contacts})
