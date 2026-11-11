from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from PIL import Image, ImageCms
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from reportlab.pdfgen import canvas
from rest_framework.test import APIClient

from accounts.models import AccountType
from companies.models import CompanyProfile
from companies.tests import grant_staff_permissions, make_account
from dealers.models import AuthorizedDealerGrant, DealerLocation, DealerProductListing
from .models import Brand, BrandCategory, CatalogueAudit, Category, Product, ProductMedia


def png(color='red'):
    target = BytesIO()
    Image.new('RGB', (10, 10), color).save(target, format='PNG')
    return target.getvalue()


def pdf(text):
    target = BytesIO()
    document = canvas.Canvas(target)
    document.drawString(20, 20, text)
    document.save()
    return target.getvalue()


@override_settings(DEBUG=True)
class ProductMediaTests(TestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        override = override_settings(CATALOGUE_MEDIA_ROOT=self.root)
        override.enable()
        self.addCleanup(override.disable)
        self.owner = make_account('+919800000081', AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(
            owner_account=self.owner, legal_name='Media fixture', company_email='fixture@example.test',
            verification_state='VERIFIED',
        )
        self.brand = Brand.objects.create(company=self.company, name='Fixture brand')
        self.category = Category.objects.create(name='Media fixture')
        self.product = Product.objects.create(
            brand_category=BrandCategory.objects.create(brand=self.brand, category=self.category),
            name='Fixture product', code='MEDIA', unit='each', state='PUBLISHED',
        )
        self.staff = make_account('+919800000082', AccountType.STAFF)
        grant_staff_permissions(self.staff, ['MODERATE_PRODUCTS'])
        self.client = APIClient()
        self.client.force_authenticate(self.staff)
        self.public = APIClient()
        self.route = f'/api/v1/staff/catalogue/products/{self.product.pk}'

    def test_item_edit_replaces_image_and_archive_removes_discovery(self):
        self.product.catalogue_price = '10.00'
        self.product.currency = 'INR'
        self.product.specifications = {'HSN': '8544', 'voltage': '240V'}
        self.product.save()
        category = Category.objects.create(name='New category')
        association = BrandCategory.objects.create(brand=self.brand, category=category)
        endpoint = f'/api/v1/catalogue/items/{self.product.pk}/'
        self.assertEqual(self.public.patch(endpoint, {'name': 'Unauthorized'}, format='json').status_code, 401)
        self.assertEqual(self.public.delete(endpoint).status_code, 401)
        self.assertEqual(self.client.patch(endpoint, {'price_per_unit': '-1'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(endpoint, {'hsn_sac_code': 'text'}, format='json').status_code, 400)
        self.assertEqual(self.upload('image', 'old.png', png(), 'image/png').status_code, 201)
        old = self.product.official_media.get().storage_name
        with self.captureOnCommitCallbacks(execute=True):
            updated = self.client.patch(endpoint, {
                'name': 'Updated fixture', 'product_code': 'MEDIA-UPDATED', 'hsn_sac_code': '8536',
                'price_per_unit': '12.25', 'brand_category': association.pk,
                'image': SimpleUploadedFile('new.png', png('blue'), 'image/png'),
            }, format='multipart')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['category_name'], 'New category')
        self.product.refresh_from_db()
        self.assertEqual(self.product.specifications, {'HSN': '8536', 'voltage': '240V'})
        self.assertFalse((self.root / old).exists())
        self.assertEqual((self.root / self.product.official_media.get().storage_name).read_bytes(), png('blue'))
        self.assertEqual(self.public.get('/api/v1/catalogue/items/').data['count'], 1)
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        self.assertEqual(self.public.get('/api/v1/catalogue/items/').data['count'], 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.state, 'ARCHIVED')
        self.assertEqual(CatalogueAudit.objects.filter(product=self.product, action='PRODUCT_ARCHIVED').count(), 1)

    def upload(self, kind, filename, content, mime, client=None):
        return (client or self.client).post(
            f'{self.route}/{kind}', {'file': SimpleUploadedFile(filename, content, mime)}, format='multipart',
        )

    def detail(self):
        return self.public.get(f'/api/v1/catalogue/products/{self.product.pk}').data

    def test_upload_replace_remove_both_slots_and_stream_current_bytes(self):
        self.assertIsNone(self.detail()['primary_image_url'])
        self.assertIsNone(self.detail()['catalogue_pdf_url'])
        for kind, name, mime, first, second, field in [
            ('image', 'fixture.png', 'image/png', png(), png('blue'), 'primary_image_url'),
            ('catalogue-pdf', 'fixture.pdf', 'application/pdf', pdf('Old'), pdf('New'), 'catalogue_pdf_url'),
        ]:
            with self.subTest(kind=kind):
                result = self.upload(kind, name, first, mime)
                self.assertEqual(result.status_code, 201, result.data)
                self.assertEqual(result.data['size'], len(first))
                self.assertTrue(result.data['uploaded_at'])
                initial = self.detail()[field]
                self.assertTrue(initial.startswith('http://testserver/media/catalogue/'))
                initial_path = self.root / ProductMedia.objects.get(product=self.product, kind=kind).storage_name
                self.assertTrue(initial_path.is_file())
                with self.captureOnCommitCallbacks(execute=True):
                    replaced = self.upload(kind, name, second, mime)
                    self.assertEqual(replaced.status_code, 200, replaced.data)
                self.assertFalse(initial_path.exists())
                current = self.detail()[field]
                self.assertNotEqual(current, initial)
                self.assertEqual(self.public.get(urlsplit(initial).path).status_code, 404)
                stream = self.public.get(urlsplit(current).path)
                self.assertTrue(stream.streaming)
                self.assertEqual(stream['Content-Type'], mime)
                self.assertEqual(b''.join(stream.streaming_content), second)
                staff_response = self.client.get(self.route + '/' + kind)
                self.assertEqual(b''.join(staff_response.streaming_content), second)
                with self.captureOnCommitCallbacks(execute=True):
                    self.assertEqual(self.client.delete(self.route + '/' + kind).status_code, 204)
                self.assertIsNone(self.detail()[field])
                self.assertEqual(self.public.get(urlsplit(current).path).status_code, 404)
        self.assertEqual(CatalogueAudit.objects.filter(action='PRODUCT_MEDIA_UPLOADED').count(), 4)
        self.assertEqual(CatalogueAudit.objects.filter(action='PRODUCT_MEDIA_REMOVED').count(), 2)
        self.assertEqual(list((self.root / 'catalogue').iterdir()), [])

    def test_mime_size_and_content_rejection(self):
        for kind, mime, content in [
            ('image', 'image/png', b'x' * (2 * 1024 * 1024 + 1)),
            ('image', 'image/svg+xml', b'<svg/>'),
            ('image', 'image/jpeg', png()),
            ('image', 'image/png', b'not an image'),
            ('catalogue-pdf', 'application/pdf', b'x' * (10 * 1024 * 1024 + 1)),
            ('catalogue-pdf', 'text/plain', pdf('Wrong type')),
            ('catalogue-pdf', 'application/pdf', b'%PDF-1.4 incomplete'),
        ]:
            with self.subTest(kind=kind, mime=mime, length=len(content)):
                self.assertEqual(self.upload(kind, 'fixture', content, mime).status_code, 400)
        self.assertFalse(ProductMedia.objects.exists())
        self.assertFalse((self.root / 'catalogue').exists())

    def test_upload_high_resolution_images_preserves_original_bytes(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        for image_format, mime, mode, dimensions in [
            ('PNG', 'image/png', 'RGBA', (4096, 4096)),
            ('JPEG', 'image/jpeg', 'RGB', (3840, 2160)),
            ('WEBP', 'image/webp', 'RGB', (1920, 1080)),
        ]:
            with self.subTest(image_format=image_format):
                target = BytesIO()
                with Image.new(mode, dimensions) as image:
                    image.save(target, format=image_format, icc_profile=profile)
                contents = target.getvalue()
                with self.captureOnCommitCallbacks(execute=True):
                    result = self.upload('image', f'fixture.{image_format.lower()}', contents, mime)
                self.assertEqual(result.status_code, 201 if image_format == 'PNG' else 200, result.data)
                response = self.client.get(self.route + '/image')
                self.assertEqual(b''.join(response.streaming_content), contents)

    def test_image_errors_distinguish_dimensions_format_and_invalid_contents(self):
        oversized = BytesIO()
        with Image.new('RGB', (4097, 10)) as image:
            image.save(oversized, format='PNG')
        for filename, mime, contents, expected in [
            ('wide.png', 'image/png', oversized.getvalue(), 'Image dimensions (4097 × 10 px)'),
            ('wrong.jpg', 'image/jpeg', png(), 'a PNG saved with a .jpg extension'),
            ('wrong.png', 'image/jpeg', png(), 'File contents are PNG'),
            ('broken.png', 'image/png', png()[:40], 'could not be recognized as a valid image'),
            ('large.png', 'image/png', b'x' * (2 * 1024 * 1024 + 1), 'File size exceeds the 2 MB limit.'),
        ]:
            with self.subTest(expected=expected):
                result = self.upload('image', filename, contents, mime)
                self.assertEqual(result.status_code, 400, result.data)
                self.assertIn(expected, str(result.data))
        self.assertFalse(ProductMedia.objects.exists())

    def test_permissions_and_product_visibility(self):
        member = APIClient()
        member.force_authenticate(self.owner)
        limited_staff = make_account('+919800000083', AccountType.STAFF)
        grant_staff_permissions(limited_staff, ['READ_AUDIT'])
        limited = APIClient()
        limited.force_authenticate(limited_staff)
        for client, status in [(self.public, 401), (member, 403), (limited, 403)]:
            for kind in ('image', 'catalogue-pdf'):
                self.assertEqual(self.upload(kind, 'fixture.png', png(), 'image/png', client).status_code, status)
                self.assertEqual(client.get(self.route + '/' + kind).status_code, status)
                self.assertEqual(client.delete(self.route + '/' + kind).status_code, status)
        self.assertEqual(self.upload('image', 'fixture.png', png(), 'image/png').status_code, 201)
        path = urlsplit(self.detail()['primary_image_url']).path
        with override_settings(DEBUG=False):
            self.assertEqual(self.public.get(path).status_code, 404)
            self.assertIsNone(self.detail()['primary_image_url'])
        self.product.moderation_state = 'HIDDEN'
        self.product.save()
        self.assertEqual(self.public.get(path).status_code, 404)
        self.assertEqual(self.public.get('/media/private_uploads/example.pdf').status_code, 404)
        response = self.client.get(self.route + '/image')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), png())

    def test_catalogue_and_dealer_discovery_share_absolute_urls(self):
        self.assertEqual(self.upload('image', 'fixture.png', png(), 'image/png').status_code, 201)
        self.assertEqual(self.upload('catalogue-pdf', 'fixture.pdf', pdf('Catalogue'), 'application/pdf').status_code, 201)
        dealer = make_account('+919800000084', AccountType.BUSINESS)
        business = dealer.business_profile
        business.verification_state = 'VERIFIED'
        business.save()
        location = DealerLocation.objects.create(
            business=business, branch_name='Fixture branch', address='Fixture address',
            pin_code='560001', locality='Central', district='Bengaluru', state='Karnataka',
            country='IN', visibility_state='VISIBLE',
        )
        AuthorizedDealerGrant.objects.create(company=self.company, brand=self.brand, business=business, actor=self.owner)
        listing = DealerProductListing.objects.create(
            location=location, product=self.product, selling_price='20', currency='INR', state='PUBLISHED',
        )
        client = APIClient()
        client.force_authenticate(dealer)
        detail = self.detail()
        catalogue = self.public.get('/api/v1/catalogue/products').data['results'][0]
        discovery = client.get('/api/v1/dealers/listings').data['results'][0]
        discovery_detail = client.get(f'/api/v1/dealers/listings/{listing.pk}').data
        for field in ('primary_image_url', 'catalogue_pdf_url'):
            self.assertTrue(detail[field].startswith('http://testserver/media/catalogue/'))
            self.assertEqual([catalogue[field], discovery[field], discovery_detail[field]], [detail[field]] * 3)
