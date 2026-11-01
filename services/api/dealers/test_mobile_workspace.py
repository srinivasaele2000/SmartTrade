from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import Account
from catalogue.models import Brand, BrandCategory, Category, Product
from companies.models import CompanyProfile
from .models import AuthorizedDealerGrant


class DealerMobileWorkspaceTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('+12025550141', 'BUSINESS')
        self.dealer = self.owner.business_profile
        self.dealer.legal_name = 'Test dealer'
        self.dealer.verification_state = 'VERIFIED'
        self.dealer.save()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.company_owner = Account.objects.create_user('+12025550142', 'COMPANY')
        self.company = CompanyProfile.objects.create(owner_account=self.company_owner, legal_name='Test supplier', company_email='test@example.test', verification_state='VERIFIED')
        self.brand = Brand.objects.create(company=self.company, name='Test brand')
        category = Category.objects.create(name='Test category')
        link = BrandCategory.objects.create(brand=self.brand, category=category)
        self.product = Product.objects.create(brand_category=link, name='Test product', code='T1', unit='each', state='PUBLISHED')
        self.grant = AuthorizedDealerGrant.objects.create(company=self.company, brand=self.brand, business=self.dealer, actor=self.company_owner, reason='Company confirmation')

    def workspace(self):
        response = self.client.get('/api/v1/businesses/me')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store')
        return response.data['workspace']

    def test_read_context_is_owner_scoped_and_cannot_grant_authorization(self):
        other = Account.objects.create_user('+12025550143', 'BUSINESS')
        other.business_profile.verification_state = 'VERIFIED'
        other.business_profile.save()
        AuthorizedDealerGrant.objects.create(company=self.company, brand=self.brand, business=other.business_profile, actor=self.company_owner, reason='Other dealer')
        value = self.workspace()
        self.assertEqual(len(value['authorizations']), 1)
        self.assertEqual(value['authorizations'][0]['id'], self.grant.pk)
        self.assertTrue(value['authorizations'][0]['eligible'])
        self.assertNotIn('actor', value['authorizations'][0])
        self.assertEqual(self.client.patch('/api/v1/businesses/me', {'workspace': {'authorizations': []}}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/v1/companies/me/dealer-authorizations', {'brand': self.brand.pk, 'business': self.dealer.pk, 'active': True, 'reason': 'Self grant'}, format='json').status_code, 403)

    def test_current_eligibility_tracks_company_suspension_and_revocation(self):
        self.company.activity_state = 'SUSPENDED'
        self.company.save()
        self.assertFalse(self.workspace()['authorizations'][0]['eligible'])
        self.assertTrue(self.workspace()['authorizations'][0]['active'])
        self.company.activity_state = 'ACTIVE'
        self.company.save()
        self.grant.active = False
        self.grant.save()
        self.assertFalse(self.workspace()['authorizations'][0]['eligible'])

    def test_counts_distinguish_published_and_discoverable_records(self):
        response = self.client.post('/api/v1/businesses/me/locations', {'branch_name': 'Branch', 'address': 'Address', 'pin_code': '12345', 'locality': 'Area', 'district': 'District', 'state': 'State', 'country': 'IN', 'visibility_state': 'VISIBLE'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.workspace()['branch_count'], 1)
        response = self.client.post('/api/v1/businesses/me/listings', {'location': response.data['id'], 'product': self.product.pk, 'selling_price': '10', 'currency': 'USD', 'state': 'PUBLISHED'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.workspace()['published_listing_count'], 1)
        self.assertEqual(self.workspace()['discoverable_listing_count'], 1)
        self.grant.active = False
        self.grant.save()
        self.assertEqual(self.workspace()['published_listing_count'], 1)
        self.assertEqual(self.workspace()['discoverable_listing_count'], 0)

    def test_pending_rejected_and_suspended_write_flags(self):
        for state, editable in [('PENDING', True), ('REJECTED', False), ('SUSPENDED', False)]:
            self.dealer.verification_state = state
            self.dealer.save()
            value = self.workspace()
            self.assertEqual(value['can_edit'], editable)
            self.assertFalse(value['can_publish_branches'])
            self.assertFalse(value['can_manage_listings'])
            self.assertFalse(value['authorizations'][0]['eligible'])

    def test_public_products_include_canonical_brand_company_identifiers(self):
        response = APIClient().get('/api/v1/catalogue/products')
        self.assertEqual(response.status_code, 200)
        value = response.data['results'][0]
        self.assertEqual(value['brand_id'], self.brand.pk)
        self.assertEqual(value['company_id'], self.company.pk)

    def test_non_business_and_blocked_accounts_rejected(self):
        self.client.force_authenticate(self.company_owner)
        self.assertEqual(self.client.get('/api/v1/businesses/me').status_code, 403)
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/v1/businesses/me').status_code, 403)
