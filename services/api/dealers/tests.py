from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import AccountType
from companies.models import CompanyProfile
from companies.tests import make_account, grant_staff_permissions
from catalogue.models import Brand, BrandCategory, Category, Product, ProductVariant
from .models import AuthorizedDealerGrant, DealerAudit, DealerLocation, DealerProductListing


class DealerTests(TestCase):
    def setUp(self):
        self.owner = make_account('+14155550501', AccountType.BUSINESS)
        self.business = self.owner.business_profile
        self.business.legal_name = 'Dealer business'
        self.business.verification_state = 'VERIFIED'
        self.business.save()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.company_owner = make_account('+14155550502', AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(owner_account=self.company_owner, legal_name='Supplier', company_email='supplier@example.test', verification_state='VERIFIED')
        self.company_client = APIClient()
        self.company_client.force_authenticate(self.company_owner)
        self.brand = Brand.objects.create(company=self.company, name='Supplier Brand')
        self.category = Category.objects.create(name='Hardware')
        self.link = BrandCategory.objects.create(brand=self.brand, category=self.category)
        self.product = Product.objects.create(brand_category=self.link, name='Hammer', code='H1', unit='piece', state='PUBLISHED', catalogue_price='10', currency='USD')
        self.variant = ProductVariant.objects.create(product=self.product, sku='RED', name='Red')
        self.location_payload = dict(branch_name='Central', address='Market street', pin_code=' 560 001 ', locality=' central   market ', district='Bengaluru', state='Karnataka', country='in', contact_phone='+14155550501', contact_email='private@example.test', visibility_state='VISIBLE')
        self.location = self.create_location()
        self.grant(active=True)
        self.payload = dict(location=self.location, product=self.product.pk, selling_price='12.50', currency='INR', stock_status='IN_STOCK', quantity='3', state='PUBLISHED')
        self.base = '/api/v1/businesses/me/listings'

    def create_location(self, **extra):
        response = self.client.post('/api/v1/businesses/me/locations', self.location_payload | extra, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def grant(self, active):
        response = self.company_client.post('/api/v1/companies/me/dealer-authorizations', {'brand': self.brand.pk, 'business': self.business.pk, 'active': active, 'reason': 'Company confirmation' if active else 'Company revocation'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def create_listing(self, **extra):
        response = self.client.post(self.base, self.payload | extra, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def discover(self, **filters):
        return self.client.get('/api/v1/dealers/listings', filters)

    def test_multiple_branches_prices_discovery_and_contact_privacy(self):
        first = self.create_listing()
        branch = self.create_location(branch_name='North', pin_code='560002', locality='North market')
        self.create_listing(location=branch, selling_price='20.75', currency='USD', stock_status='OUT_OF_STOCK', quantity='0')
        result = self.discover(pin_code='560 001', product=self.product.pk, brand=self.brand.pk, stock_status='IN_STOCK')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['count'], 1)
        row = result.data['results'][0]
        self.assertEqual(row['id'], first)
        self.assertEqual(row['selling_price'], '12.5000')
        self.assertEqual(row['company_catalogue_price'], '10.0000')
        self.assertEqual(row['currency'], 'INR')
        self.assertNotIn('contact_phone', row['branch'])
        self.assertNotIn('contact_email', row['branch'])
        self.assertEqual(row['branch']['locality'], 'CENTRAL MARKET')
        fallback = self.discover(pin_code='missing', locality=' north   market ')
        self.assertEqual(fallback.data['match_level'], 'LOCALITY')
        self.assertEqual(fallback.data['results'][0]['location'], branch)
        self.assertEqual(self.discover(district='bengaluru').data['count'], 2)
        self.assertEqual(APIClient().get('/api/v1/dealers/listings').status_code, 401)

    def test_cross_dealer_ownership_and_variant_product_isolation(self):
        pk = self.create_listing()
        other = make_account('+14155550503', AccountType.BUSINESS)
        profile = other.business_profile
        profile.verification_state = 'VERIFIED'
        profile.save()
        self.client.force_authenticate(other)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '1'}, format='json').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'active': False}, format='json').status_code, 404)
        self.assertEqual(self.client.get(self.base).data['count'], 0)
        self.assertEqual(self.client.get(f'{self.base}/{pk}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/v1/businesses/me/locations/{self.location}').status_code, 404)
        self.assertEqual(self.client.post(self.base, self.payload | {'variant': self.variant.pk}, format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        other_product = Product.objects.create(brand_category=self.link, name='Other', code='H2', unit='piece', state='PUBLISHED')
        variant = ProductVariant.objects.create(product=other_product, name='Wrong', sku='WRONG')
        self.assertEqual(self.client.post(self.base, self.payload | {'variant': variant.pk}, format='json').status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.create(location_id=self.location, product=self.product, variant=variant, selling_price=1, currency='USD')

    def test_revocation_withdrawal_and_reauthorization_preserve_history(self):
        pk = self.create_listing()
        self.grant(active=False)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.get(f'/api/v1/dealers/listings/{pk}').status_code, 404)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '3'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'WITHDRAWN'}, format='json').status_code, 200)
        self.grant(active=True)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'PUBLISHED'}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 1)
        self.assertEqual(AuthorizedDealerGrant.objects.count(), 1)
        self.assertTrue(DealerAudit.objects.filter(listing_id=pk, action='LISTING_WITHDRAWN', actor=self.owner).exists())
        self.assertEqual(DealerAudit.objects.filter(grant__isnull=False).count(), 3)

    def test_company_suspension_catalogue_moderation_and_account_blocks(self):
        pk = self.create_listing()
        self.company.activity_state = 'SUSPENDED'
        self.company.save()
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '9'}, format='json').status_code, 403)
        self.company.activity_state = 'ACTIVE'
        self.company.save()
        Product.objects.filter(pk=self.product.pk).update(moderation_state='HIDDEN')
        self.assertEqual(self.discover().data['count'], 0)
        Product.objects.filter(pk=self.product.pk).update(moderation_state='VISIBLE')
        self.company_owner.access_state = 'BLOCKED'
        self.company_owner.save()
        self.assertEqual(self.discover().data['count'], 0)
        self.company_owner.access_state = 'ACTIVE'
        self.company_owner.save()
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '9'}, format='json').status_code, 403)
        customer = make_account('+14155550504', AccountType.PERSONAL)
        self.client.force_authenticate(customer)
        self.assertEqual(self.discover().data['count'], 0)

    def test_partial_uniqueness_invalid_money_stock_and_locations(self):
        self.create_listing()
        self.assertEqual(self.client.post(self.base, self.payload, format='json').status_code, 400)
        self.create_listing(variant=self.variant.pk)
        self.assertEqual(self.client.post(self.base, self.payload | {'variant': self.variant.pk}, format='json').status_code, 400)
        branch = self.create_location(branch_name='Extra')
        for extra in [{'selling_price': '-1'}, {'currency': 'usd'}, {'currency': ''}, {'quantity': '-1'}, {'stock_status': 'OUT_OF_STOCK', 'quantity': '2'}, {'stock_status': 'IN_STOCK', 'quantity': '0'}, {'stock_status': 'UNKNOWN', 'quantity': '1'}]:
            self.assertEqual(self.client.post(self.base, self.payload | {'location': branch} | extra, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/v1/businesses/me/locations', self.location_payload | {'country': 'IND'}, format='json').status_code, 400)
        self.assertEqual(self.discover(stock_status='BAD').status_code, 400)
        self.assertEqual(self.discover(product='BAD').status_code, 400)

    def test_business_verification_staff_moderation_and_draft_locations(self):
        pk = self.create_listing()
        self.business.verification_state = 'PENDING'
        self.business.save()
        draft = self.create_location(branch_name='Draft', visibility_state='PRIVATE_DRAFT')
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{draft}', {'visibility_state': 'VISIBLE'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch('/api/v1/businesses/me', {'verification_state': 'VERIFIED'}, format='json').status_code, 400)
        self.assertEqual(self.discover().data['count'], 0)
        staff = make_account('+14155550505', AccountType.STAFF)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        staff_client = APIClient()
        staff_client.force_authenticate(staff)
        path = f'/api/v1/staff/dealers/businesses/{self.business.pk}/decision'
        self.assertEqual(staff_client.post(path, {'action': 'APPROVE', 'reason': ' '}, format='json').status_code, 400)
        self.assertEqual(staff_client.post(path, {'action': 'APPROVE', 'reason': 'Registration checked'}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 1)
        self.assertEqual(staff_client.post(f'/api/v1/staff/dealers/locations/{self.location}/moderation', {'hidden': True, 'reason': 'Branch review'}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'admin_hidden': False}, format='json').status_code, 400)
        self.assertEqual(staff_client.get(f'/api/v1/staff/dealers/listings?location={self.location}').data['count'], 1)
        self.assertEqual(staff_client.post(path, {'action': 'SUSPEND', 'reason': 'Business review'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '9'}, format='json').status_code, 403)
        self.assertEqual(DealerAudit.objects.get(action='BUSINESS_APPROVE').actor_id, staff.pk)

    def test_company_owner_only_grants_and_cross_company_brand_denied(self):
        payload = {'brand': self.brand.pk, 'business': self.business.pk, 'active': True, 'reason': 'Grant'}
        path = '/api/v1/companies/me/dealer-authorizations'
        self.assertEqual(self.client.post(path, payload, format='json').status_code, 403)
        other = make_account('+14155550506', AccountType.COMPANY)
        CompanyProfile.objects.create(owner_account=other, legal_name='Other Company', company_email='other@example.test', verification_state='VERIFIED')
        self.company_client.force_authenticate(other)
        self.assertEqual(self.company_client.post(path, payload, format='json').status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            AuthorizedDealerGrant.objects.filter(brand=self.brand).update(company=other.owned_company)

    def test_deactivation_withdrawal_and_append_only_audit(self):
        pk = self.create_listing()
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'active': False}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertTrue(DealerProductListing.objects.filter(pk=pk).exists())
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'WITHDRAWN'}, format='json').status_code, 200)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerAudit.objects.update(reason='Tamper')
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerAudit.objects.all().delete()

    def test_database_identity_money_and_nullable_variant_uniqueness(self):
        pk = self.create_listing()
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.create(location_id=self.location, product=self.product, selling_price=1, currency='USD')
        branch = self.create_location(branch_name='Branch 2')
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.filter(pk=pk).update(location_id=branch)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.filter(pk=pk).update(currency='usd')
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.filter(pk=pk).update(quantity=-1)
        self.grant(active=False)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.filter(pk=pk).update(selling_price=20)

    def test_grant_requires_verified_business_and_staff_cannot_grant(self):
        self.business.verification_state = 'PENDING'
        self.business.save()
        data = {'brand': self.brand.pk, 'business': self.business.pk, 'active': True, 'reason': 'Confirmation'}
        path = '/api/v1/companies/me/dealer-authorizations'
        self.assertEqual(self.company_client.post(path, data, format='json').status_code, 400)
        staff = make_account('+14155550507', AccountType.STAFF)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(path, data, format='json').status_code, 403)

    def test_product_and_variant_publication_eligibility(self):
        Product.objects.filter(pk=self.product.pk).update(state='DRAFT')
        self.assertEqual(self.client.post(self.base, self.payload, format='json').status_code, 403)
        Product.objects.filter(pk=self.product.pk).update(state='PUBLISHED')
        self.create_listing(variant=self.variant.pk)
        ProductVariant.objects.filter(pk=self.variant.pk).update(active=False)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.post(self.base, self.payload | {'variant': self.variant.pk}, format='json').status_code, 403)

    def test_staff_permission_and_business_restore_does_not_unblock_account(self):
        staff = make_account('+14155550508', AccountType.STAFF)
        grant_staff_permissions(staff, ['READ_REPORTS'])
        client = APIClient()
        client.force_authenticate(staff)
        self.assertEqual(client.get('/api/v1/staff/dealers/businesses').status_code, 403)
        self.business.verification_state = 'SUSPENDED'
        self.business.save()
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        reviewer = make_account('+14155550509', AccountType.STAFF)
        grant_staff_permissions(reviewer, ['REVIEW_BUSINESS'])
        client.force_authenticate(reviewer)
        result = client.post(f'/api/v1/staff/dealers/businesses/{self.business.pk}/decision', {'action': 'RESTORE', 'reason': 'Business evidence accepted'}, format='json')
        self.assertEqual(result.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.access_state, 'BLOCKED')
        self.assertEqual(self.discover().status_code, 403)

    def test_different_company_product_requires_its_own_brand_grant(self):
        other_owner = make_account('+14155550510', AccountType.COMPANY)
        other_company = CompanyProfile.objects.create(owner_account=other_owner, legal_name='Second supplier', company_email='second@example.test', verification_state='VERIFIED')
        brand = Brand.objects.create(company=other_company, name='Second brand')
        link = BrandCategory.objects.create(brand=brand, category=self.category)
        product = Product.objects.create(brand_category=link, name='Second hammer', code='S1', unit='piece', state='PUBLISHED')
        self.assertEqual(self.client.post(self.base, self.payload | {'product': product.pk}, format='json').status_code, 403)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerProductListing.objects.create(location_id=self.location, product=product, selling_price=1, currency='USD', state='PUBLISHED')
        self.assertEqual(DealerProductListing.objects.count(), 0)

    def test_drafts_visibility_and_live_detail_filters(self):
        pk = self.create_listing(state='WITHDRAWN', stock_status='UNKNOWN', quantity=None)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'PUBLISHED'}, format='json').status_code, 200)
        self.assertEqual(self.client.get(f'/api/v1/dealers/listings/{pk}').status_code, 200)
        self.assertEqual(self.discover(pin_code='missing', locality='missing', district='missing').data['count'], 0)
        self.assertEqual(self.discover(pin_code='  ').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'visibility_state': 'PRIVATE_DRAFT'}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.get(self.base, {'location': self.location}).data['count'], 1)

    def test_location_ownership_is_immutable_in_database(self):
        other = make_account('+14155550511', AccountType.BUSINESS)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DealerLocation.objects.filter(pk=self.location).update(business=other.business_profile)
        self.assertEqual(self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'business': other.business_profile.pk}, format='json').status_code, 400)


    def test_duplicate_grants_and_duplicate_revocations_do_not_change_audit(self):
        path = '/api/v1/companies/me/dealer-authorizations'
        payload = {'brand': self.brand.pk, 'business': self.business.pk, 'active': True, 'reason': 'Duplicate'}
        before = DealerAudit.objects.count()
        self.assertEqual(self.company_client.post(path, payload, format='json').status_code, 409)
        self.assertEqual(DealerAudit.objects.count(), before)
        self.assertEqual(AuthorizedDealerGrant.objects.count(), 1)
        self.grant(False)
        revoked = AuthorizedDealerGrant.objects.get()
        self.assertEqual(self.company_client.post(path, payload | {'active': False}, format='json').status_code, 409)
        self.grant(True)
        self.assertEqual(AuthorizedDealerGrant.objects.get().pk, revoked.pk)
        self.assertEqual(DealerAudit.objects.filter(grant=revoked).count(), 3)
        with self.assertRaises(IntegrityError), transaction.atomic():
            AuthorizedDealerGrant.objects.create(company=self.company, brand=self.brand, business=self.business, actor=self.company_owner, reason='Duplicate scope')

    def test_revoking_nonexistent_scope_creates_nothing_and_readonly_fields_rejected(self):
        brand = Brand.objects.create(company=self.company, name='No grant')
        path = '/api/v1/companies/me/dealer-authorizations'
        body = {'brand': brand.pk, 'business': self.business.pk, 'active': False, 'reason': 'No existing grant'}
        count = DealerAudit.objects.count()
        self.assertEqual(self.company_client.post(path, body, format='json').status_code, 404)
        self.assertEqual(AuthorizedDealerGrant.objects.count(), 1)
        self.assertEqual(DealerAudit.objects.count(), count)
        self.assertEqual(self.company_client.post(path, body | {'actor': self.owner.pk}, format='json').status_code, 400)
        self.assertEqual(self.company_client.post(path, body | {'company': self.company.pk}, format='json').status_code, 400)

    def test_company_dealer_search_is_private_minimal_and_eligible_only(self):
        pending = make_account('+14155550520', AccountType.BUSINESS)
        path = '/api/v1/companies/me/dealers'
        response = self.company_client.get(path, {'search': 'dealer', 'page_size': 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(set(response.data['results'][0]), {'id', 'legal_name', 'verification_state'})
        self.assertEqual(self.company_client.get(path, {'search': str(self.business.pk)}).data['count'], 1)
        self.assertEqual(self.company_client.get(path, {'search': str(pending.business_profile.pk)}).data['count'], 0)
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.assertEqual(self.company_client.get(path).data['count'], 0)
        self.assertEqual(APIClient().get(path).status_code, 401)
        self.assertEqual(self.client.get(path).status_code, 403)

    def test_grant_transitions_enforce_company_and_account_restrictions(self):
        path = '/api/v1/companies/me/dealer-authorizations'
        body = {'brand': self.brand.pk, 'business': self.business.pk, 'active': False, 'reason': 'Should be denied'}
        for verification, activity in [('PENDING', 'ACTIVE'), ('REJECTED', 'ACTIVE'), ('VERIFIED', 'SUSPENDED')]:
            self.company.verification_state, self.company.activity_state = verification, activity
            self.company.save()
            self.assertEqual(self.company_client.post(path, body, format='json').status_code, 403)
            self.assertEqual(self.company_client.get(path).status_code, 200)
            self.assertEqual(self.company_client.get('/api/v1/companies/me/dealers').status_code, 403)
        self.company.verification_state, self.company.activity_state = 'VERIFIED', 'ACTIVE'
        self.company.save()
        self.company_owner.access_state = 'BLOCKED'
        self.company_owner.save()
        self.assertEqual(self.company_client.post(path, body, format='json').status_code, 403)
        self.assertEqual(self.company_client.get(path).status_code, 403)

    def test_dealer_cannot_authorize_itself_and_blocked_target_cannot_receive_grant(self):
        path = '/api/v1/companies/me/dealer-authorizations'
        body = {'brand': self.brand.pk, 'business': self.business.pk, 'active': False, 'reason': 'Company action'}
        self.assertEqual(self.client.post(path, body | {'active': True}, format='json').status_code, 403)
        self.grant(False)
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.assertEqual(self.company_client.post(path, body | {'active': True}, format='json').status_code, 400)

    def test_authorization_inspection_filters_and_history_permissions(self):
        staff = make_account('+14155550521', AccountType.STAFF)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        client = APIClient(); client.force_authenticate(staff)
        path = '/api/v1/staff/dealers/authorizations'
        response = client.get(path, {'search': 'Supplier Brand', 'active': 'true', 'company': self.company.pk, 'brand': self.brand.pk, 'business': self.business.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        row = response.data['results'][0]
        self.assertTrue(row['eligible'])
        self.assertEqual(row['business_name'], self.business.legal_name)
        self.assertNotIn('contact_phone', row)
        for query in [{'active': 'yes'}, {'brand': 'invalid'}]:
            self.assertEqual(client.get(path, query).status_code, 400)
        self.assertEqual(self.company_client.get(path).status_code, 403)
        self.assertEqual(client.get('/api/v1/staff/dealers/authorization-audit').status_code, 403)
        audit_staff = make_account('+14155550522', AccountType.STAFF)
        grant_staff_permissions(audit_staff, ['READ_AUDIT'])
        client.force_authenticate(audit_staff)
        self.grant(False)
        result = client.get('/api/v1/staff/dealers/authorization-audit', {'grant': row['id'], 'page_size': 1})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['count'], 2)
        self.assertEqual(result.data['results'][0]['action'], 'DEALER_AUTHORIZATION_REVOKED')
        self.assertFalse(result.data['results'][0]['snapshot']['active'])
        self.assertEqual(result.data['results'][0]['actor'], self.company_owner.pk)
        self.assertEqual(result.data['results'][0]['reason'], 'Company revocation')
        self.assertEqual(client.get(path).status_code, 403)
        self.assertEqual(client.get('/api/v1/staff/dealers/authorization-audit', {'grant': 'invalid'}).status_code, 400)

    def test_revocation_immediately_invalidates_existing_listing_and_dealer_context(self):
        pk = self.create_listing()
        self.assertTrue(self.client.get('/api/v1/businesses/me').data['workspace']['authorizations'][0]['eligible'])
        self.grant(False)
        self.assertEqual(self.client.get(f'/api/v1/dealers/listings/{pk}').status_code, 404)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '11'}, format='json').status_code, 403)
        self.assertFalse(self.client.get('/api/v1/businesses/me').data['workspace']['authorizations'][0]['active'])
        self.assertTrue(DealerProductListing.objects.filter(pk=pk).exists())
        self.assertTrue(DealerAudit.objects.filter(action='DEALER_AUTHORIZATION_REVOKED').exists())


    def test_authorization_and_discovery_reads_do_not_cache_eligibility(self):
        for path in ['/api/v1/companies/me/dealers', '/api/v1/companies/me/dealer-authorizations']:
            self.assertIn('no-store', self.company_client.get(path)['Cache-Control'])
        pk = self.create_listing()
        for path in ['/api/v1/dealers/listings', f'/api/v1/dealers/listings/{pk}']:
            self.assertIn('no-store', self.client.get(path)['Cache-Control'])
        staff = make_account('+14155550523', AccountType.STAFF)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS', 'READ_AUDIT'])
        self.client.force_authenticate(staff)
        for path in ['/api/v1/staff/dealers/authorizations', '/api/v1/staff/dealers/authorization-audit']:
            self.assertIn('no-store', self.client.get(path)['Cache-Control'])


    def test_listing_lifecycle_and_current_metadata(self):
        pk = self.create_listing(variant=self.variant.pk, state='WITHDRAWN')
        path = f'{self.base}/{pk}'
        owner = self.client.get(path).data
        self.assertFalse(owner['eligible'])
        self.assertEqual(owner['variant_sku'], self.variant.sku)
        self.assertEqual(owner['company_name'], self.company.legal_name)
        self.assertEqual(self.client.patch(path, {'state': 'PUBLISHED'}, format='json').status_code, 200)
        self.assertTrue(self.client.get(path).data['eligible'])
        self.assertEqual(self.client.patch(path, {'selling_price': '19.75', 'stock_status': 'OUT_OF_STOCK', 'quantity': '0'}, format='json').status_code, 200)
        public = self.discover(variant=self.variant.pk).data['results'][0]
        self.assertEqual(public['selling_price'], '19.7500')
        self.assertEqual(public['quantity'], '0.0000')
        self.assertEqual(self.client.patch(path, {'state': 'WITHDRAWN'}, format='json').status_code, 200)
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(path, {'state': 'PUBLISHED'}, format='json').status_code, 200)
        self.assertEqual(DealerProductListing.objects.get(pk=pk).pk, pk)
        self.assertEqual(DealerAudit.objects.filter(listing_id=pk).count(), 5)
        self.assertTrue(DealerAudit.objects.filter(listing_id=pk, action='LISTING_WITHDRAWN').exists())

    def test_listing_search_filters_scope_and_readonly_metadata(self):
        pk = self.create_listing(variant=self.variant.pk)
        self.assertEqual(self.client.get(self.base, {'search': self.variant.sku, 'state': 'PUBLISHED', 'stock_status': 'IN_STOCK'}).data['count'], 1)
        self.assertEqual(self.client.get(self.base, {'search': 'missing'}).data['count'], 0)
        for values in [{'state': 'DRAFT'}, {'stock_status': 'INVALID'}, {'location': 'bad'}]:
            self.assertEqual(self.client.get(self.base, values).status_code, 400)
        for values in [{'eligible': True}, {'company_name': 'Fake'}, {'variant_sku': 'Fake'}]:
            self.assertEqual(self.client.patch(f'{self.base}/{pk}', values, format='json').status_code, 400)
        staff = make_account('+14155550530', AccountType.STAFF)
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        self.client.force_authenticate(staff)
        response = self.client.get('/api/v1/staff/dealers/listings', {'company': self.company.pk, 'business': self.business.pk, 'location': self.location, 'product': self.product.pk, 'brand': self.brand.pk, 'search': self.variant.sku, 'state': 'PUBLISHED'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['variant_sku'], self.variant.sku)
        self.assertTrue(response.data['results'][0]['eligible'])

    def test_buyer_variant_filter_is_applied_before_pagination(self):
        self.create_listing()
        first = self.create_listing(variant=self.variant.pk)
        branch = self.create_location(branch_name='Second test branch')
        second = self.create_listing(location=branch, variant=self.variant.pk, currency='USD')
        page = self.client.get('/api/v1/dealers/listings', {'variant': self.variant.pk, 'page_size': 1})
        self.assertEqual(page.data['count'], 2)
        self.assertEqual(page.data['results'][0]['id'], first)
        page2 = self.client.get('/api/v1/dealers/listings', {'variant': self.variant.pk, 'page_size': 1, 'page': 2})
        self.assertEqual(page2.data['results'][0]['id'], second)
        self.assertEqual(self.discover(variant='bad').status_code, 400)
        self.assertNotIn('contact_email', page2.data['results'][0]['branch'])

    def test_duplicate_variant_listing_is_rejected_without_audit_and_sku_cannot_be_written(self):
        self.create_listing(variant=self.variant.pk)
        before = DealerAudit.objects.count()
        self.assertEqual(self.client.post(self.base, self.payload | {'variant': self.variant.pk}, format='json').status_code, 400)
        self.assertEqual(DealerAudit.objects.count(), before)
        self.assertEqual(self.client.post(self.base, self.payload | {'sku': 'Fake'}, format='json').status_code, 400)

    def test_inactive_variant_and_branch_prevent_reactivation_but_allow_withdrawal(self):
        pk = self.create_listing(variant=self.variant.pk)
        self.variant.active = False; self.variant.save()
        self.assertEqual(self.discover().data['count'], 0)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'selling_price': '14'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'WITHDRAWN'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'PUBLISHED'}, format='json').status_code, 403)
        self.variant.active = True; self.variant.save()
        self.client.patch(f'/api/v1/businesses/me/locations/{self.location}', {'active': False}, format='json')
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'PUBLISHED'}, format='json').status_code, 403)
        self.assertTrue(DealerProductListing.objects.filter(pk=pk).exists())

    def test_listing_audit_is_readonly_permissioned_and_filtered(self):
        pk = self.create_listing(variant=self.variant.pk)
        path = '/api/v1/staff/dealers/listing-audit'
        self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(APIClient().get(path).status_code, 401)
        staff = make_account('+14155550531', AccountType.STAFF)
        grant_staff_permissions(staff, ['READ_AUDIT'])
        self.client.force_authenticate(staff)
        response = self.client.get(path, {'listing': pk, 'business': self.business.pk, 'location': self.location})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        event = response.data['results'][0]
        self.assertEqual(event['actor'], self.owner.pk)
        self.assertEqual(event['snapshot']['variant_sku'], self.variant.sku)
        self.assertNotIn('contact_phone', event['snapshot'])
        self.assertEqual(self.client.get(path, {'listing': 'invalid'}).status_code, 400)
        self.assertEqual(self.client.post(path, {}, format='json').status_code, 405)
