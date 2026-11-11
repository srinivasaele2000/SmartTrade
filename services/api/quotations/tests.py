from decimal import Decimal
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Account
from catalogue.models import Brand, BrandCategory, Category, Product, ProductMedia
from companies.models import CompanyProfile
from companies.tests import grant_staff_permissions
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
