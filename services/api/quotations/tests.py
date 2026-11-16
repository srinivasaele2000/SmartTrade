from decimal import Decimal
from io import BytesIO
from tempfile import TemporaryDirectory

import pdfplumber
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Account
from catalogue.models import Brand, BrandCategory, Category, Product, ProductMedia
from companies.models import CompanyProfile
from companies.tests import grant_staff_permissions
from dealers.models import TradeWorkerContact
from .models import Bill
from .views import calculate


class CatalogueEstimateBillTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        company_owner = Account.objects.create_user('+919800000071', 'COMPANY')
        company = CompanyProfile.objects.create(owner_account=company_owner, legal_name='Fixture company',
            company_email='fixture@example.test', verification_state='VERIFIED')
        brand = Brand.objects.create(company=company, name='Fixture brand')
        category = Category.objects.create(name='Electrical')
        self.association = BrandCategory.objects.create(brand=brand, category=category)
        self.staff = Account.objects.create_user('+919800000072', 'STAFF')
        grant_staff_permissions(self.staff, ['MODERATE_PRODUCTS'])
        self.dealer = Account.objects.create_user('+919800000073', 'BUSINESS')
        profile = self.dealer.business_profile
        profile.verification_state = 'VERIFIED'
        profile.legal_name = 'Fixture dealer'
        profile.save()

    def test_private_general_items_and_mixed_estimate_snapshots(self):
        base = '/api/v1/dealers/general-items/'
        estimates = '/api/v1/dealers/estimates/'
        other = Account.objects.create_user('+919800000074', 'BUSINESS')
        profile = other.business_profile
        profile.verification_state = 'VERIFIED'
        profile.save(update_fields=['verification_state'])
        self.client.force_authenticate(self.dealer)
        denied = self.client.get(base)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data['code'], 'ONBOARDING_STEP_2_REQUIRED')
        for account in (self.dealer, other):
            now = timezone.now()
            business = account.business_profile
            business.contacts_submitted_at = now
            business.save(update_fields=['contacts_submitted_at'])
            TradeWorkerContact.objects.bulk_create([
                TradeWorkerContact(business=business, name=f'Worker {i}', trade='Electrician',
                                   mobile_e164=f'+919800{account.pk % 1000:03}{i:03}', consent_confirmed_at=now)
                for i in range(10)
            ])
        product = Product.objects.create(brand_category=self.association, name='Master cable', code='MASTER-1',
                                         unit='meter', state='PUBLISHED', catalogue_price='100', currency='INR')
        baseline = tuple(model.objects.count() for model in (Product, Brand, Category))
        public = APIClient()
        discovery = public.get('/api/v1/dealers/discover/', {'city': 'Hyderabad'}).data
        minimal = self.client.post(base, {'product_name': 'Private hardware', 'list_price_per_unit': '0'}, format='json')
        self.assertEqual(minimal.status_code, 201, minimal.data)
        self.assertEqual(minimal.data['product_code'], '')
        self.assertEqual(self.client.post(base, {'product_name': 'Invalid', 'list_price_per_unit': '-1'}, format='json').status_code, 400)
        custom = self.client.post(base, {'product_name': 'Private fitting', 'product_code': 'GEN-1', 'hsn_sac_code': '7318',
                                         'list_price_per_unit': '12.50'}, format='json')
        self.assertEqual(custom.status_code, 201, custom.data)
        item = custom.data['id']
        detail = f'{base}{item}/'
        for q in ('fitting', 'GEN-1', '7318'):
            self.assertEqual(self.client.get(base, {'q': q}).data['count'], 1)
        line = {'dealer_custom_item': item, 'quantity': '2', 'unit_price': '15.00'}
        document = {'items': [{'product': product.pk, 'quantity': '1'}, line], 'status': 'SHARED',
                    'discount_percentage': '0', 'gst_type': 'CGST_SGST', 'gst_rate_percentage': '18'}
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(base).data['count'], 0)
        self.assertEqual(self.client.patch(detail, {'product_name': 'Other'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(detail).status_code, 404)
        self.assertEqual(self.client.post(estimates, document, format='json').status_code, 404)
        self.client.force_authenticate(self.dealer)
        for invalid in ({**line, 'product': product.pk}, {'quantity': '1'}):
            self.assertEqual(self.client.post(estimates, {**document, 'items': [invalid]}, format='json').status_code, 400)
        custom_only = self.client.post(estimates, {**document, 'items': [line]}, format='json')
        self.assertEqual(custom_only.status_code, 201, custom_only.data)
        self.assertEqual(custom_only.data['totals']['total_amount'], '35.40')
        saved = self.client.post(estimates, document, format='json')
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(saved.data['totals']['total_amount'], '153.40')
        self.assertEqual(saved.data['items'][1]['source'], 'GENERAL')
        self.assertEqual(saved.data['items'][1]['list_price_per_unit'], '12.5000')
        self.assertEqual(self.client.patch(detail, {'product_name': 'Renamed', 'list_price_per_unit': '99'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertEqual(self.client.get(base, {'q': 'GEN-1'}).data['count'], 0)
        self.assertEqual(self.client.post(estimates, document, format='json').status_code, 404)
        estimate_url = f"{estimates}{saved.data['id']}/"
        retained = self.client.patch(estimate_url, document, format='json')
        self.assertEqual(retained.status_code, 200, retained.data)
        bill = self.client.post(estimate_url + 'convert-to-bill/', {}, format='json')
        self.assertEqual(bill.status_code, 201, bill.data)
        snapshot = bill.data['snapshot']['items'][1]
        self.assertEqual((snapshot['product_name'], snapshot['product_code'], snapshot['hsn_sac_code'], snapshot['unit_price']),
                         ('Private fitting', 'GEN-1', '7318', '15.0000'))
        response = self.client.get(f"/api/v1/dealers/bills/{bill.data['id']}/pdf/")
        self.assertEqual(response.status_code, 200)
        with pdfplumber.open(BytesIO(response.content)) as pdf:
            self.assertIn('Private fitting', pdf.pages[0].extract_text())
        self.assertEqual(tuple(model.objects.count() for model in (Product, Brand, Category)), baseline)
        self.assertEqual(public.get('/api/v1/catalogue/items/', {'search': 'GEN-1'}).data['count'], 0)
        self.assertEqual(public.get('/api/v1/dealers/discover/', {'city': 'Hyderabad'}).data, discovery)

    def test_item_discounts_persist_and_customer_pdfs_show_only_net_prices(self):
        self.client.force_authenticate(self.staff)
        product = self.client.post('/api/v1/catalogue/items/', {
            'name': 'Fixture cable', 'product_code': 'DISC-TEST', 'price_per_unit': '100', 'hsn_sac_code': '8544',
            'brand_category': self.association.pk,
        })
        self.assertEqual(product.status_code, 201, product.data)
        self.client.force_authenticate(self.dealer)
        base = '/api/v1/dealers/estimates/'
        for mode in ('PERCENT', 'AMOUNT'):
            with self.subTest(mode=mode):
                line = {'product': product.data['id'], 'quantity': '2', 'discount_mode': mode, 'discount_value': '10'}
                data = {'items': [line], 'discount_percentage': '0', 'gst_type': 'CGST_SGST',
                        'gst_rate_percentage': '18', 'status': 'SHARED'}
                invalid = self.client.post(base, {**data, 'items': [{**line, 'discount_value': '101'}]}, format='json')
                self.assertEqual(invalid.status_code, 400)
                self.assertEqual(self.client.post(base, {**data, 'discount_percentage': '1'}, format='json').status_code, 400)
                estimate = self.client.post(base, data, format='json')
                self.assertEqual(estimate.status_code, 201, estimate.data)
                self.assertEqual(estimate.data['items'][0]['net_unit_rate'], '90.0000')
                self.assertEqual(estimate.data['totals']['taxable_amount'], '180.00')
                self.assertEqual(estimate.data['totals']['cgst_amount'], '16.20')
                self.assertEqual(estimate.data['totals']['total_amount'], '212.40')
                detail = f"{base}{estimate.data['id']}/"
                bill = self.client.post(detail + 'convert-to-bill/', {}, format='json')
                self.assertEqual(bill.status_code, 201, bill.data)
                self.assertEqual(bill.data['snapshot']['items'][0]['net_unit_rate'], '90.0000')
                for url in (detail + 'pdf/', f"/api/v1/dealers/bills/{bill.data['id']}/pdf/"):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 200)
                    with pdfplumber.open(BytesIO(response.content)) as pdf:
                        content = '\n'.join(page.extract_text() for page in pdf.pages)
                    for amount in ('90.00', '180.00', '212.40'):
                        self.assertIn(amount, content)
                    self.assertNotIn('100.00', content)
                    self.assertNotIn('discount', content.lower())

    def test_upload_item_and_convert_confirmed_estimate(self):
        image = BytesIO()
        Image.new('RGB', (32, 32), 'green').save(image, format='PNG')
        fields = {'name': 'Fixture cable', 'product_code': 'QA-001', 'hsn_sac_code': '8544',
                  'price_per_unit': '100', 'brand_category': self.association.pk}
        url = '/api/v1/catalogue/items/'
        self.assertEqual(self.client.post(url, fields).status_code, 401)
        self.client.force_authenticate(self.staff)
        with TemporaryDirectory() as folder, override_settings(CATALOGUE_MEDIA_ROOT=folder):
            response = self.client.post(url, {**fields, 'image': SimpleUploadedFile('item.png', image.getvalue(), 'image/png')})
            self.assertEqual(response.status_code, 201, response.data)
            self.assertTrue(ProductMedia.objects.filter(product_id=response.data['id']).exists())
            self.assertEqual(self.client.get(url).data['results'][0]['hsn_sac_code'], '8544')
            self.assertEqual(self.client.post(url, fields).status_code, 400)
        product = response.data['id']
        self.client.force_authenticate(self.dealer)
        base = '/api/v1/dealers/estimates/'
        data = {'items': [{'product': product, 'quantity': '2'}], 'discount_percentage': '5',
                'gst_type': 'CGST_SGST', 'gst_rate_percentage': '18'}
        draft = self.client.post(base, data, format='json')
        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertEqual(draft.data['totals'], {'sub_total': '200.00', 'discount_amount': '10.00',
            'taxable_amount': '190.00', 'cgst_amount': '17.10', 'sgst_amount': '17.10',
            'igst_amount': '0.00', 'total_amount': '224.20'})
        detail = base + str(draft.data['id']) + '/'
        self.assertEqual(self.client.post(detail + 'convert-to-bill/', {}, format='json').status_code, 409)
        Product.objects.filter(pk=product).update(catalogue_price=Decimal('120'))
        confirmed = self.client.patch(detail, {**data, 'status': 'SHARED'}, format='json')
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.assertEqual(confirmed.data['totals']['total_amount'], '224.20')
        self.assertTrue(self.client.get(detail + 'pdf/').content.startswith(b'%PDF'))
        bill = self.client.post(detail + 'convert-to-bill/', {}, format='json')
        self.assertEqual(bill.status_code, 201, bill.data)
        self.assertEqual(bill.data['payment_status'], 'UNPAID')
        self.assertEqual(self.client.post(detail + 'convert-to-bill/', {}, format='json').data['id'], bill.data['id'])
        self.assertEqual(Bill.objects.count(), 1)
        self.assertEqual(self.client.patch(detail, data, format='json').status_code, 409)
        bills = '/api/v1/dealers/bills/'
        self.assertEqual(self.client.get(bills).data['count'], 1)
        bill_pdf = bills + str(bill.data['id']) + '/pdf/'
        self.assertTrue(self.client.get(bill_pdf).content.startswith(b'%PDF'))
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.delete(f'/api/v1/catalogue/items/{product}/').status_code, 204)
        self.client.force_authenticate(self.dealer)
        self.assertEqual(self.client.get(base).data['results'][0]['items'][0]['unit_price'], '100.0000')
        self.assertEqual(self.client.get(bills).data['results'][0]['snapshot']['totals']['total_amount'], '224.20')
        self.assertTrue(self.client.get(bill_pdf).content.startswith(b'%PDF'))
        other = Account.objects.create_user('+919800000074', 'BUSINESS')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(detail + 'pdf/').status_code, 404)
        self.assertEqual(self.client.get(bill_pdf).status_code, 404)

    def test_igst_and_odd_paise_split(self):
        igst = calculate(Decimal('200.00'), Decimal('5'), 'IGST', Decimal('18'))
        self.assertEqual(igst['igst_amount'], '34.20')
        self.assertEqual(igst['total_amount'], '224.20')
        split = calculate(Decimal('0.05'), Decimal('0'), 'CGST_SGST', Decimal('20'))
        self.assertEqual(Decimal(split['cgst_amount']) + Decimal(split['sgst_amount']), Decimal('0.01'))
        self.assertEqual(split['total_amount'], '0.06')
