from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import AccountType
from companies.models import CompanyProfile
from companies.tests import make_account, grant_staff_permissions
from .models import Brand, BrandCategory, CatalogueAudit, Category, Product, ProductVariant


class CatalogueTests(TestCase):
    def setUp(self):
        self.owner = make_account('+14155550401', AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(owner_account=self.owner, legal_name='Catalogue owner', company_email='catalogue@example.test', verification_state='VERIFIED')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.public = APIClient()
        self.category = Category.objects.create(name='Tools')
        self.brand = Brand.objects.create(company=self.company, name='Tools Brand')
        self.link = BrandCategory.objects.create(brand=self.brand, category=self.category)
        self.payload = {'brand_category': self.link.pk, 'name': 'Hammer', 'code': 'HAM-1', 'unit': 'piece'}
        self.base = '/api/v1/companies/me/catalogue/products'

    def create_product(self, **extra):
        response = self.client.post(self.base, self.payload | extra, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def test_draft_publish_variants_and_public_search(self):
        pk = self.create_product(catalogue_price='125.5000', currency='INR')
        self.assertEqual(self.public.get('/api/v1/catalogue/products').data['count'], 0)
        variant = self.client.post(f'{self.base}/{pk}/variants', {'sku': 'H-RED', 'name': 'Red', 'attributes': {'color': 'red'}}, format='json')
        self.assertEqual(variant.status_code, 201)
        self.assertEqual(self.client.post(f'{self.base}/{pk}/variants', {'sku': 'H-RED', 'name': 'Duplicate'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'PUBLISHED'}, format='json').status_code, 200)
        listing = self.public.get('/api/v1/catalogue/products', {'search': 'hammer', 'category': self.category.pk})
        self.assertEqual(listing.data['count'], 1)
        self.assertEqual(listing.data['results'][0]['variants'][0]['sku'], 'H-RED')
        self.assertEqual(self.public.get('/api/v1/catalogue/products', {'category': 'invalid'}).status_code, 400)
        self.assertEqual(self.public.get('/api/v1/catalogue/products', {'page_size': 1}).data['count'], 1)
        event = CatalogueAudit.objects.get(action='PRODUCT_UPDATED')
        self.assertEqual(event.actor_id, self.owner.pk)
        self.assertEqual(event.product_id, pk)
        self.assertEqual(event.snapshot['state'], 'PUBLISHED')
        self.assertIsNotNone(event.occurred_at)

    def test_pending_rejected_suspended_and_blocked_are_denied_writes(self):
        pk = self.create_product(state='PUBLISHED')
        for verification, activity in [('PENDING', 'ACTIVE'), ('REJECTED', 'ACTIVE'), ('VERIFIED', 'SUSPENDED')]:
            self.company.verification_state = verification
            self.company.activity_state = activity
            self.company.save()
            self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'name': 'Changed'}, format='json').status_code, 403)
            self.assertEqual(self.client.post(self.base, self.payload, format='json').status_code, 403)
            self.assertEqual(self.public.get(f'/api/v1/catalogue/products/{pk}').status_code, 404)
        self.company.verification_state = 'VERIFIED'
        self.company.activity_state = 'ACTIVE'
        self.company.save()
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'name': 'Changed'}, format='json').status_code, 403)
        self.assertEqual(self.public.get('/api/v1/catalogue/products').data['count'], 0)
        self.assertTrue(Product.objects.filter(pk=pk).exists())

    def test_cross_company_and_client_controlled_fields_rejected(self):
        pk = self.create_product()
        other = make_account('+14155550402', AccountType.COMPANY)
        company = CompanyProfile.objects.create(owner_account=other, legal_name='Other', company_email='other@example.test', verification_state='VERIFIED')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post(self.base, self.payload | {'code': 'OTHER'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'name': 'Stolen'}, format='json').status_code, 404)
        self.assertEqual(self.client.post(f'{self.base}/{pk}/variants', {'sku': 'STOLEN', 'name': 'Stolen'}, format='json').status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'moderation_state': 'VISIBLE'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/v1/companies/me/catalogue/brands', {'name': 'Fake', 'company': company.pk}, format='json').status_code, 400)

    def test_invalid_values_and_database_constraints(self):
        for extra in [{'state': 'INVALID'}, {'catalogue_price': '-1', 'currency': 'INR'}, {'catalogue_price': '10'}, {'specifications': []}, {'currency': 'INR'}]:
            self.assertEqual(self.client.post(self.base, self.payload | extra, format='json').status_code, 400)
        self.category.active = False
        self.category.save()
        self.assertEqual(self.client.post(self.base, self.payload, format='json').status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            BrandCategory.objects.create(brand=self.brand, category=self.category)

    def test_staff_moderation_and_restoration_do_not_bypass_company_suspension(self):
        pk = self.create_product(state='PUBLISHED')
        path = f'/api/v1/staff/catalogue/products/{pk}/moderation'
        self.assertEqual(self.client.post(path, {'action': 'HIDE', 'reason': 'Test'}, format='json').status_code, 403)
        staff = make_account('+14155550403', AccountType.STAFF)
        grant_staff_permissions(staff, ['MODERATE_PRODUCTS'])
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(path, {'action': 'HIDE', 'reason': ' '}, format='json').status_code, 400)
        self.assertEqual(self.client.post(path, {'action': 'HIDE', 'reason': 'Evidence review'}, format='json').status_code, 200)
        self.assertEqual(self.public.get('/api/v1/catalogue/products').data['count'], 0)
        self.company.activity_state = 'SUSPENDED'
        self.company.save()
        self.assertEqual(self.client.post(path, {'action': 'RESTORE', 'reason': 'Product evidence accepted'}, format='json').status_code, 200)
        self.assertEqual(self.public.get('/api/v1/catalogue/products').data['count'], 0)
        event = CatalogueAudit.objects.get(action='PRODUCT_RESTORE')
        self.assertEqual(event.actor_id, staff.pk)
        self.assertEqual(event.reason, 'Product evidence accepted')

    def test_category_and_brand_prerequisites(self):
        path = '/api/v1/staff/catalogue/categories'
        self.assertEqual(self.client.post(path, {'name': 'Hardware'}, format='json').status_code, 403)
        staff = make_account('+14155550404', AccountType.STAFF)
        grant_staff_permissions(staff, ['MANAGE_TAXONOMY'])
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(path, {'name': 'Hardware'}, format='json').status_code, 201)
        self.assertTrue(CatalogueAudit.objects.filter(action='CATEGORY_CREATED', actor=staff).exists())
        self.client.force_authenticate(self.owner)
        brand = self.client.post('/api/v1/companies/me/catalogue/brands', {'name': 'New brand'}, format='json')
        self.assertEqual(brand.status_code, 201)
        link = self.client.post('/api/v1/companies/me/catalogue/brand-categories', {'brand': brand.data['id'], 'category': self.category.pk}, format='json')
        self.assertEqual(link.status_code, 201)

    def test_postgresql_audit_is_append_only(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.create_product()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueAudit.objects.update(reason='Tampered')

    def test_archive_and_variant_deactivation_preserve_records(self):
        pk = self.create_product(state='PUBLISHED')
        variant = self.client.post(f'{self.base}/{pk}/variants', {'sku': 'V1', 'name': 'Variant'}, format='json')
        path = f'{self.base}/{pk}/variants/{variant.data["id"]}'
        self.assertEqual(self.client.patch(path, {'active': False}, format='json').status_code, 200)
        self.assertEqual(self.public.get(f'/api/v1/catalogue/products/{pk}').data['variants'], [])
        self.assertEqual(self.client.patch(f'{self.base}/{pk}', {'state': 'ARCHIVED'}, format='json').status_code, 200)
        self.assertEqual(self.public.get(f'/api/v1/catalogue/products/{pk}').status_code, 404)
        self.assertTrue(ProductVariant.objects.filter(pk=variant.data['id']).exists())
        self.assertTrue(CatalogueAudit.objects.filter(action='VARIANT_UPDATED').exists())

    def test_database_ownership_and_price_guards(self):
        pk = self.create_product()
        brand = Brand.objects.create(company=self.company, name='Other Brand')
        link = BrandCategory.objects.create(brand=brand, category=self.category)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.filter(pk=pk).update(brand_category=link)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.filter(pk=pk).update(currency='INR', catalogue_price=None)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueAudit.objects.all().delete()

    def test_unauthenticated_and_dealer_writes_denied(self):
        self.assertEqual(self.public.post(self.base, self.payload, format='json').status_code, 401)
        dealer = make_account('+14155550405', AccountType.BUSINESS)
        self.client.force_authenticate(dealer)
        self.assertEqual(self.client.post(self.base, self.payload, format='json').status_code, 403)

    def test_postgresql_company_state_guards_direct_writes(self):
        pk = self.create_product()
        self.company.activity_state = 'SUSPENDED'
        self.company.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Brand.objects.create(company=self.company, name='Suspended brand')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.filter(pk=pk).update(state='PUBLISHED')
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductVariant.objects.create(product_id=pk, sku='BYPASS', name='Bypass')


    def test_brand_edit_is_owned_validated_and_audited(self):
        path = f'/api/v1/companies/me/catalogue/brands/{self.brand.pk}'
        response = self.client.patch(path, {'name': 'Edited brand'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['company'], self.company.pk)
        self.assertEqual(response.data['categories'][0]['id'], self.category.pk)
        event = CatalogueAudit.objects.get(action='BRAND_UPDATED')
        self.assertEqual(event.actor, self.owner)
        self.assertEqual(event.snapshot['name'], 'Edited brand')
        self.assertEqual(self.client.patch(path, {'company': 999}, format='json').status_code, 400)
        Brand.objects.create(company=self.company, name='Duplicate')
        self.assertEqual(self.client.patch(path, {'name': 'Duplicate'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'name': ''}, format='json').status_code, 400)

    def test_brand_edit_cross_company_unverified_and_suspended_denied(self):
        path = f'/api/v1/companies/me/catalogue/brands/{self.brand.pk}'
        for verification, activity in [('PENDING', 'ACTIVE'), ('REJECTED', 'ACTIVE'), ('VERIFIED', 'SUSPENDED')]:
            self.company.verification_state, self.company.activity_state = verification, activity
            self.company.save()
            self.assertEqual(self.client.patch(path, {'name': 'Denied'}, format='json').status_code, 403)
        other = make_account('+14155550406', AccountType.COMPANY)
        CompanyProfile.objects.create(owner_account=other, legal_name='Other owner', company_email='other@example.test', verification_state='VERIFIED')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.patch(path, {'name': 'Stolen'}, format='json').status_code, 404)

    def test_staff_category_update_requires_permission_and_reason_and_preserves_history(self):
        pk = self.create_product(state='PUBLISHED')
        path = f'/api/v1/staff/catalogue/categories/{self.category.pk}'
        self.assertEqual(self.client.patch(path, {'active': False, 'reason': 'test'}, format='json').status_code, 403)
        staff = make_account('+14155550407', AccountType.STAFF)
        grant_staff_permissions(staff, ['MANAGE_TAXONOMY'])
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.patch(path, {'active': False}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'active': False, 'reason': 'Category review'}, format='json').status_code, 200)
        self.assertEqual(self.public.get(f'/api/v1/catalogue/products/{pk}').status_code, 404)
        self.assertTrue(Product.objects.filter(pk=pk).exists())
        event = CatalogueAudit.objects.get(action='CATEGORY_UPDATED')
        self.assertEqual(event.reason, 'Category review')
        self.assertFalse(event.snapshot['active'])
        self.assertEqual(self.client.patch(path, {'active': True, 'reason': 'Category restored'}, format='json').status_code, 200)
        self.assertEqual(self.public.get(f'/api/v1/catalogue/products/{pk}').status_code, 200)

    def test_staff_brand_inspection_and_audit_have_separate_permissions(self):
        pk = self.create_product()
        staff = make_account('+14155550408', AccountType.STAFF)
        grant_staff_permissions(staff, ['MODERATE_PRODUCTS'])
        self.client.force_authenticate(staff)
        response = self.client.get('/api/v1/staff/catalogue/brands')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['company_name'], self.company.legal_name)
        self.assertEqual(self.client.get('/api/v1/staff/catalogue/audit').status_code, 403)
        permission_staff = make_account('+14155550409', AccountType.STAFF)
        grant_staff_permissions(permission_staff, ['READ_AUDIT'])
        self.client.force_authenticate(permission_staff)
        response = self.client.get('/api/v1/staff/catalogue/audit', {'product': pk, 'page_size': 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['snapshot']['name'], self.payload['name'])
        self.assertEqual(response.data['results'][0]['actor'], self.owner.pk)
        self.assertEqual(self.client.get('/api/v1/staff/catalogue/audit', {'product': 'invalid'}).status_code, 400)
        self.assertEqual(self.public.get('/api/v1/staff/catalogue/audit').status_code, 401)

    def test_owner_product_search_state_and_pagination(self):
        self.create_product()
        self.create_product(name='Other', code='SECOND', state='PUBLISHED')
        result = self.client.get(self.base, {'search': 'Other', 'state': 'PUBLISHED', 'page_size': 1})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['count'], 1)
        self.assertEqual(result.data['results'][0]['code'], 'SECOND')
        self.assertEqual(self.client.get(self.base, {'state': 'INVALID'}).status_code, 400)

    def test_variant_edit_duplicate_sku_and_immutable_product(self):
        pk = self.create_product()
        one = self.client.post(f'{self.base}/{pk}/variants', {'sku': 'ONE', 'name': 'One'}, format='json')
        two = self.client.post(f'{self.base}/{pk}/variants', {'sku': 'TWO', 'name': 'Two'}, format='json')
        path = f"{self.base}/{pk}/variants/{two.data['id']}"
        self.assertEqual(self.client.patch(path, {'sku': 'ONE'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'product': pk}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'attributes': []}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(path, {'sku': 'THREE', 'attributes': {'size': 'large'}}, format='json').status_code, 200)
        self.assertEqual(CatalogueAudit.objects.get(action='VARIANT_UPDATED').variant_id, two.data['id'])
