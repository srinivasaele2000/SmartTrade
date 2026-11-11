from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Account, BusinessProfile
from companies.tests import grant_staff_permissions, make_account
from .models import DealerAudit


class ClientOnboardingTests(TestCase):
    registration = '/api/v1/auth/dealer/register/'
    batch = '/api/v1/dealers/contacts/batch/'
    directory = '/api/v1/admin/dealers/'

    def setUp(self):
        self.client = APIClient()
        self.registration_data = {'firm_name': 'Disposable Electricals', 'gstin': '36aabcv5678b1zv',
                                  'mobile_number': '+919800000071', 'business_type': 'ELECTRICAL'}
        self.contacts = [{'name': f'Disposable worker {index}', 'trade': 'Electrician',
                          'mobile_e164': f'+9198000001{index:02}', 'consent': True}
                         for index in range(10)]

    def test_registration_is_pending_and_preserves_unique_account(self):
        for key, value in [('gstin', 'invalid'), ('mobile_number', '123'), ('business_type', 'INVALID')]:
            self.assertEqual(self.client.post(self.registration, {**self.registration_data, key: value}, format='json').status_code, 400)
        response = self.client.post(self.registration, self.registration_data, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        account = Account.objects.get(mobile_e164=self.registration_data['mobile_number'])
        self.assertEqual(account.account_type, 'BUSINESS')
        self.assertIsNone(account.mobile_verified_at)
        dealer = account.business_profile
        self.assertEqual((dealer.legal_name, dealer.gstin, dealer.business_type, dealer.verification_state),
                         ('Disposable Electricals', '36AABCV5678B1ZV', 'ELECTRICAL', 'PENDING'))
        self.assertEqual(self.client.post(self.registration, self.registration_data, format='json').status_code, 409)
        self.client.force_authenticate(account)
        profile = self.client.get('/api/v1/businesses/me')
        self.assertEqual(profile.data['business_type'], 'ELECTRICAL')
        self.assertIsNone(profile.data['contacts_submitted_at'])
        self.assertEqual(self.client.patch('/api/v1/businesses/me', {'business_type': 'OTHER'}, format='json').status_code, 400)

    def test_batch_is_atomic_exact_and_private(self):
        dealer = make_account('+919800000071', 'BUSINESS')
        buyer = make_account('+919800000072', 'PERSONAL')
        self.assertEqual(self.client.post(self.batch, {'contacts': self.contacts}, format='json').status_code, 401)
        self.client.force_authenticate(buyer)
        self.assertEqual(self.client.post(self.batch, {'contacts': self.contacts}, format='json').status_code, 403)
        self.client.force_authenticate(dealer)
        for batch in (self.contacts[:-1], self.contacts + [self.contacts[0]], self.contacts[:-1] + [self.contacts[0]],
                      [{**self.contacts[0], 'consent': False}, *self.contacts[1:]]):
            self.assertEqual(self.client.post(self.batch, {'contacts': batch}, format='json').status_code, 400)
            self.assertEqual(dealer.business_profile.trade_contacts.count(), 0)
        response = self.client.post(self.batch, {'contacts': self.contacts}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(dealer.business_profile.trade_contacts.count(), 10)
        self.assertIsNotNone(self.client.get('/api/v1/businesses/me').data['contacts_submitted_at'])
        self.assertEqual(self.client.post(self.batch, {'contacts': self.contacts}, format='json').status_code, 409)
        other_dealer = make_account('+919800000074', 'BUSINESS')
        self.client.force_authenticate(other_dealer)
        self.assertEqual(self.client.get(self.directory).status_code, 403)
        self.assertEqual(other_dealer.business_profile.trade_contacts.count(), 0)

    def test_directory_requires_separate_contact_permission(self):
        dealer = make_account('+919800000071', 'BUSINESS')
        staff = make_account('+919800000073', 'STAFF')
        contact_reviewer = make_account('+919800000075', 'STAFF')
        details = f'{self.directory}{dealer.business_profile.pk}/contacts/'
        self.client.force_authenticate(dealer)
        self.assertEqual(self.client.post(self.batch, {'contacts': self.contacts}, format='json').status_code, 201)
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(self.directory).status_code, 403)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        row = self.client.get(self.directory).data['results'][0]
        self.assertEqual(row['contact_count'], 10)
        self.assertNotIn('contacts', row)
        self.assertEqual(self.client.get(details).status_code, 403)
        grant_staff_permissions(contact_reviewer, ['REVIEW_TRADE_CONTACTS'])
        self.client.force_authenticate(contact_reviewer)
        response = self.client.get(details)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['results']), 10)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertIsNotNone(BusinessProfile.objects.get(account=dealer).contacts_submitted_at)

    def test_directory_search_detail_and_private_inspection_audit(self):
        dealer = make_account('+919800000071', 'BUSINESS')
        profile = dealer.business_profile
        BusinessProfile.objects.filter(pk=profile.pk).update(
            legal_name='Directory Electric', owner_name='Fixture Owner', gstin='36AABCV5678B1ZV',
            business_type='ELECTRICAL', sub_category='LIGHTING', trade_license='TL-FIXTURE-01',
            registered_pin_code='500003', registered_locality='Ranigunj',
        )
        make_account('+919800000072', 'BUSINESS')
        self.client.force_authenticate(dealer)
        self.assertEqual(self.client.post(self.batch, {'contacts': self.contacts}, format='json').status_code, 201)
        url = f'{self.directory}{profile.pk}/'
        self.assertEqual(self.client.get(url).status_code, 403)
        reviewer = make_account('+919800000073', 'STAFF')
        grant_staff_permissions(reviewer, ['REVIEW_BUSINESS'])
        self.client.force_authenticate(reviewer)
        for search in ('directory electric', '+91 98000 00071', '36aabcv5678b1zv'):
            listing = self.client.get(self.directory, {'search': search, 'business_type': 'ELECTRICAL'})
            self.assertEqual(listing.data['count'], 1)
            self.assertNotIn('worker_contacts', listing.data['results'][0])
        self.assertEqual(self.client.get(self.directory, {'page_size': 1}).data['count'], 2)
        self.assertEqual(self.client.get(self.directory, {'business_type': 'PLUMBING'}).data['count'], 0)
        self.assertEqual(self.client.get(self.directory, {'business_type': 'invalid'}).status_code, 400)
        self.assertIsNone(self.client.get(url).data['worker_contacts'])
        self.assertFalse(DealerAudit.objects.filter(action='CONTACTS_REVIEWED').exists())
        inspector = make_account('+919800000075', 'STAFF')
        grant_staff_permissions(inspector, ['REVIEW_BUSINESS', 'REVIEW_TRADE_CONTACTS'])
        self.client.force_authenticate(inspector)
        detail = self.client.get(url)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(detail['Cache-Control'], 'no-store')
        self.assertEqual(detail.data['address']['pincode'], '500003')
        self.assertEqual(detail.data['trade_license'], 'TL-FIXTURE-01')
        self.assertEqual(detail.data['sub_category'], 'LIGHTING')
        self.assertEqual(len(detail.data['worker_contacts']), 10)
        worker = detail.data['worker_contacts'][0]
        self.assertTrue(worker['consent_obtained'])
        self.assertTrue(worker['submitted_at'].endswith('Z'))
        self.assertEqual(DealerAudit.objects.get(action='CONTACTS_REVIEWED').snapshot, {
            'count': 10, 'source': 'dealer_directory',
        })
