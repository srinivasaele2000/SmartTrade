from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Account, StaffPermission, StaffRole, StaffRoleAssignment
from catalogue.models import Brand, BrandCategory, Category
from companies.models import CompanyProfile
from .models import AuthorizedDealerGrant, BrandSuggestion, DealerAudit, DealerLocation, TradeWorkerContact


class OnboardingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.buyer = Account.objects.create_user('+919800000071', 'PERSONAL')
        self.other_buyer = Account.objects.create_user('+919800000072', 'PERSONAL')
        self.owner = Account.objects.create_user('+919800000073', 'BUSINESS')
        self.other = Account.objects.create_user('+919800000074', 'BUSINESS')
        self.company_account = Account.objects.create_user('+919800000075', 'COMPANY')
        self.staff = Account.objects.create_user('+919800000076', 'STAFF')
        self.dealer = self.owner.business_profile
        self.company = CompanyProfile.objects.create(
            owner_account=self.company_account, legal_name='Disposable supplier',
            company_email='fixture@example.test', verification_state='VERIFIED',
        )
        self.brand = Brand.objects.create(company=self.company, name='Disposable brand')
        BrandCategory.objects.create(brand=self.brand, category=Category.objects.create(name='Electrical'))
        self.base = '/api/v1/businesses/me'
        self.staff_base = f'/api/v1/staff/dealers/businesses/{self.dealer.pk}'

    def authorize_staff(self, *codes):
        role, _ = StaffRole.objects.get_or_create(code='PACKAGE_B_TEST_REVIEWER')
        role.permissions.add(*(StaffPermission.objects.get_or_create(code=code)[0] for code in codes))
        StaffRoleAssignment.objects.get_or_create(staff_account=self.staff, role=role, grant_source='BOOTSTRAP')
        self.client.force_authenticate(self.staff)

    def test_personal_registration_provisions_profile_and_owner_can_edit(self):
        url = '/api/v1/auth/personal-profile'
        self.assertEqual(self.client.get(url).status_code, 401)
        self.client.force_authenticate(self.buyer)
        self.assertEqual(self.client.get(url).data['full_name'], '')
        response = self.client.patch(url, {
            'full_name': 'Disposable buyer', 'occupation': 'Electrician', 'pin_code': '560001',
            'locality': 'Central', 'district': 'Bengaluru', 'state': 'karnataka',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(response.data['state'], 'Karnataka')
        self.assertEqual(response.data['mobile_e164'], self.buyer.mobile_e164)
        for data in ({'mobile_e164': self.other_buyer.mobile_e164}, {'pin_code': '123'},
                     {'state': 'Ontario'}, {'account': self.other_buyer.pk}):
            self.assertEqual(self.client.patch(url, data, format='json').status_code, 400)
        self.client.force_authenticate(self.other_buyer)
        self.assertEqual(self.client.get(url).data['full_name'], '')
        self.assertEqual(self.client.get(f'{url}/{self.buyer.pk}').status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_registered_address_is_validated_owner_scoped_and_distinct_from_branches(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(self.base, {
            'owner_name': 'Disposable owner', 'business_email': 'dealer@example.test',
            'registered_address': 'Registered address', 'registered_pin_code': '560001',
            'registered_locality': 'Central', 'registered_district': 'Bengaluru', 'registered_state': 'karnataka',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['registered_state'], 'Karnataka')
        self.assertFalse(DealerLocation.objects.exists())
        self.assertNotIn('dealer@example.test', str(DealerAudit.objects.get(action='BUSINESS_UPDATED').snapshot))
        for data in ({'registered_pin_code': '12345'}, {'registered_state': 'Ontario'},
                     {'business_email': 'invalid'}, {'id': self.other.business_profile.pk}):
            self.assertEqual(self.client.patch(self.base, data, format='json').status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.base).data['registered_address'], '')
        self.assertEqual(self.client.get(self.staff_base + '/onboarding').status_code, 403)

    def test_multiple_declarations_filter_brands_without_grant_or_taxonomy_writes(self):
        self.client.force_authenticate(self.owner)
        options = self.client.get(self.base + '/declaration-brands?category=Electrical')
        self.assertEqual([row['id'] for row in options.data['results']], [self.brand.pk])
        url = self.base + '/declarations'
        bad = self.client.put(url, {'categories': ['Plumbing'], 'brands': [self.brand.pk]}, format='json')
        self.assertEqual(bad.status_code, 400)
        response = self.client.put(url, {'categories': ['Electrical', 'Plumbing'], 'brands': [self.brand.pk]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['categories'], ['Electrical', 'Plumbing'])
        self.assertFalse(AuthorizedDealerGrant.objects.exists())
        self.assertEqual(Category.objects.count(), 1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).data['brands'], [])

    def test_suggestion_review_outcomes_and_audit_keep_canonical_ownership(self):
        for index, outcome in enumerate(['APPROVED', 'REJECTED', 'MAPPED']):
            self.client.force_authenticate(self.owner)
            url = self.base + '/brand-suggestions'
            name = f'Brand idea {index}'
            suggestion = self.client.post(url, {'name': name, 'context': 'Catalogue reference'}, format='json')
            self.assertEqual(suggestion.status_code, 201, suggestion.data)
            self.assertEqual(self.client.post(url, {'name': name.upper().replace(' ', '  ')}, format='json').status_code, 400)
            review = f'{self.staff_base}/brand-suggestions/{suggestion.data["id"]}/review'
            payload = {'action': outcome, 'reason': 'Reviewed against canonical catalogue'}
            if outcome == 'MAPPED':
                payload['brand'] = self.brand.pk
            self.assertEqual(self.client.post(review, payload, format='json').status_code, 403)
            self.authorize_staff('REVIEW_BUSINESS')
            self.assertEqual(self.client.post(review, {**payload, 'reason': ''}, format='json').status_code, 400)
            result = self.client.post(review, payload, format='json')
            self.assertEqual(result.status_code, 200, result.data)
            self.assertEqual(result.data['status'], outcome)
            self.assertEqual(self.client.post(review, payload, format='json').status_code, 409)
        self.assertEqual(BrandSuggestion.objects.get(status='MAPPED').canonical_brand, self.brand)
        self.assertEqual(DealerAudit.objects.filter(action='BRAND_SUGGESTION_REVIEWED', actor=self.staff).count(), 3)
        self.assertEqual(Brand.objects.count(), 1)
        self.assertFalse(AuthorizedDealerGrant.objects.exists())

    def test_contact_consent_duplicate_removal_and_restricted_review(self):
        self.client.force_authenticate(self.owner)
        url = self.base + '/trade-contacts'
        data = {'name': 'Disposable worker', 'mobile_e164': '+919800000077', 'trade': 'Electrician'}
        for invalid in (data, {**data, 'consent': False}, {**data, 'consent': True, 'mobile_e164': '+12025550101'}):
            self.assertEqual(self.client.post(url, invalid, format='json').status_code, 400)
        response = self.client.post(url, {**data, 'consent': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data['consent_confirmed'])
        self.assertTrue(response.data['consent_confirmed_at'])
        self.assertNotIn('consent', response.data)
        pk = response.data['id']
        self.assertEqual(self.client.get(url).data['minimum_required'], 10)
        self.assertEqual(self.client.post(url, {**data, 'consent': True}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'{url}/{pk}', {'trade': 'Plumber'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'{url}/{pk}', {'trade': 'Plumber', 'consent': True}, format='json').status_code, 200)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).data['count'], 0)
        self.assertEqual(self.client.delete(f'{url}/{pk}').status_code, 404)
        self.authorize_staff('REVIEW_BUSINESS')
        staff_url = self.staff_base + '/trade-contacts'
        self.assertEqual(self.client.get(staff_url).status_code, 403)
        onboarding = self.client.get(self.staff_base + '/onboarding')
        self.assertNotIn(data['mobile_e164'], str(onboarding.data))
        self.authorize_staff('REVIEW_TRADE_CONTACTS')
        self.assertEqual(self.client.get(staff_url).data['count'], 1)
        self.assertTrue(DealerAudit.objects.filter(action='CONTACTS_REVIEWED', actor=self.staff).exists())
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f'{url}/{pk}').status_code, 204)
        self.assertFalse(TradeWorkerContact.objects.exists())
        self.assertNotIn(data['mobile_e164'], str(list(DealerAudit.objects.values_list('snapshot', flat=True))))

    def test_duplicate_signals_review_and_changed_candidate(self):
        other = self.other.business_profile
        self.dealer.registration_number = 'Firm-42'
        self.dealer.save()
        other.registration_number = 'FIRM 42'
        other.save()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(self.staff_base + '/onboarding').status_code, 403)
        self.authorize_staff('REVIEW_BUSINESS')
        matches = self.client.get(self.staff_base + '/onboarding').data['duplicates']
        self.assertEqual(matches[0]['business'], other.pk)
        self.assertEqual(matches[0]['signals'], ['registration'])
        payload = {'fingerprint': matches[0]['fingerprint'], 'outcome': 'DISTINCT', 'reason': 'Separate jurisdictions'}
        self.assertEqual(self.client.post(self.staff_base + '/duplicate-review', payload, format='json').status_code, 200)
        result = self.client.get(self.staff_base + '/onboarding').data['duplicates'][0]
        self.assertEqual(result['decision']['outcome'], 'DISTINCT')
        other.registration_number = 'Firm 43'
        other.save()
        self.assertEqual(self.client.post(self.staff_base + '/duplicate-review', payload, format='json').status_code, 409)
        self.dealer.refresh_from_db()
        self.assertEqual(self.dealer.verification_state, 'PENDING')
        self.assertEqual(Account.objects.filter(pk__in=[self.owner.pk, self.other.pk]).count(), 2)

    def test_suspended_business_cannot_mutate_onboarding(self):
        self.dealer.verification_state = 'SUSPENDED'
        self.dealer.save()
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.put(self.base + '/declarations', {'categories': [], 'brands': []}, format='json').status_code, 403)
        self.assertEqual(self.client.post(self.base + '/brand-suggestions', {'name': 'Test'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(self.base + '/trade-contacts', {}, format='json').status_code, 403)

    def test_shared_address_alone_does_not_flag_distinct_businesses(self):
        other = self.other.business_profile
        for profile, name in ((self.dealer, 'Fixture Electric'), (other, 'Separate Plumbing')):
            profile.legal_name = name
            profile.registered_address = 'Suite 1, Test Plaza'
            profile.registered_pin_code = '560001'
            profile.save()
        self.authorize_staff('REVIEW_BUSINESS')
        self.assertEqual(self.client.get(self.staff_base + '/onboarding').data['duplicates'], [])
        other.legal_name = 'FIXTURE   Electric'
        other.registered_address = 'Suite 1 Test Plaza'
        other.save()
        match = self.client.get(self.staff_base + '/onboarding').data['duplicates'][0]
        self.assertEqual(match['signals'], ['name and registered address'])
        self.assertIsNone(match['decision'])
