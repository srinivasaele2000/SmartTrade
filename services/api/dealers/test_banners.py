from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from companies.tests import grant_staff_permissions, make_account
from .models import DealerBanner, TradeWorkerContact


class DealerBannerTests(TestCase):
    admin_url = '/api/v1/banners/admin/'
    feed_url = '/api/v1/banners/dealer/'

    def setUp(self):
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        settings = override_settings(MEDIA_ROOT=root.name)
        settings.enable()
        self.addCleanup(settings.disable)
        staff = make_account('+919800000071', 'STAFF')
        grant_staff_permissions(staff, ['REVIEW_BUSINESS'])
        self.staff = APIClient()
        self.staff.force_authenticate(staff)
        self.dealer = make_account('+919800000072', 'BUSINESS')
        self.mobile = APIClient()
        token = RefreshToken.for_user(self.dealer)
        token['token_version'] = self.dealer.token_version
        self.mobile.credentials(HTTP_AUTHORIZATION='Bearer ' + str(token.access_token))

    def upload(self, **fields):
        image = SimpleUploadedFile('banner.png', self.png_bytes(), 'image/png')
        return self.staff.post(self.admin_url, {'title': 'Test banner', 'image': image, **fields}, format='multipart')

    def complete(self):
        business = self.dealer.business_profile
        now = timezone.now()
        business.contacts_submitted_at = now
        business.save(update_fields=['contacts_submitted_at'])
        TradeWorkerContact.objects.bulk_create([
            TradeWorkerContact(business=business, name=f'Worker {i}', trade='Electrician',
                               mobile_e164=f'+9198000990{i:02}', consent_confirmed_at=now)
            for i in range(10)
        ])

    def test_feed_schedule_order_and_api_permissions(self):
        denied = self.mobile.get(self.feed_url)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data['code'], 'ONBOARDING_STEP_2_REQUIRED')
        self.complete()
        self.assertEqual(self.mobile.get(self.admin_url).status_code, 403)
        now = timezone.now()
        items = [
            self.upload(title='First', sort_order=2, starts_at=''),
            self.upload(title='Second', sort_order=8, target_type='support_chat'),
            self.upload(title='Scheduled', starts_at=(now + timedelta(days=1)).isoformat()),
            self.upload(title='Expired', ends_at=(now - timedelta(days=1)).isoformat()),
            self.upload(title='Inactive', is_active=False),
        ]
        for item in items:
            self.assertEqual(item.status_code, 201, item.data)
        admin = self.staff.get(self.admin_url).data['banners']
        self.assertEqual({row['title']: row['status'] for row in admin}, {
            'First': 'Active', 'Second': 'Active', 'Scheduled': 'Scheduled', 'Expired': 'Expired', 'Inactive': 'Inactive',
        })
        first, second = [item.data['id'] for item in items[:2]]
        feed = self.mobile.get(self.feed_url).data['banners']
        self.assertEqual([row['id'] for row in feed], [first, second])
        image = '/api/v1' + feed[0]['image_url']
        self.assertEqual(APIClient().get(image).status_code, 401)
        downloaded = self.mobile.get(image)
        self.assertEqual(downloaded['Content-Type'], 'image/png')
        self.assertTrue(b''.join(downloaded.streaming_content).startswith(b'\x89PNG'))
        ids = [second, first, *[item.data['id'] for item in items[2:]]]
        self.assertEqual(self.staff.post(self.admin_url + 'reorder/', {'ids': ids}, format='json').status_code, 200)
        self.assertEqual([row['id'] for row in self.mobile.get(self.feed_url).data['banners']], [second, first])
        self.assertEqual(self.staff.patch(self.admin_url + f'{first}/', {'is_active': False}, format='json').status_code, 200)
        self.assertEqual(self.mobile.get(image).status_code, 404)

    def test_validation_replacement_and_deletion(self):
        for file in (
            SimpleUploadedFile('bad.png', b'<html>', 'image/png'),
            SimpleUploadedFile('big.png', b'0' * (8 * 1024 * 1024 + 1), 'image/png'),
        ):
            self.assertEqual(self.upload(image=file).status_code, 400)
        self.assertEqual(self.upload(target_type='item').status_code, 400)
        now = timezone.now()
        self.assertEqual(self.upload(starts_at=now.isoformat(), ends_at=(now - timedelta(days=1)).isoformat()).status_code, 400)
        created = self.upload()
        self.assertEqual(created.status_code, 201, created.data)
        row = DealerBanner.objects.get(pk=created.data['id'])
        old = row.image.name
        url = self.admin_url + f'{row.pk}/'
        with row.image.open('rb') as stream:
            replacement = SimpleUploadedFile('replacement.png', stream.read(), 'image/png')
        with self.captureOnCommitCallbacks(execute=True):
            updated = self.staff.patch(url, {'image': replacement, 'title': 'Updated'}, format='multipart')
        self.assertEqual(updated.status_code, 200, updated.data)
        row.refresh_from_db()
        self.assertEqual(row.title, 'Updated')
        self.assertFalse(row.image.storage.exists(old))
        self.assertTrue(row.image.storage.exists(row.image.name))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.staff.delete(url).status_code, 204)
        self.assertFalse(row.image.storage.exists(row.image.name))

    def test_text_and_legacy_image_banners_share_the_ordered_feed(self):
        self.complete()
        image = self.upload(title='Artwork', sort_order=4)
        self.assertEqual(image.status_code, 201, image.data)
        self.assertEqual(image.data['banner_type'], 'image')
        self.assertTrue(image.data['image_url'])

        for fields in (
            {},
            {'banner_type': 'text', 'title': '  '},
            {'banner_type': 'text', 'title': 'Notice', 'theme_preset': 'unknown'},
            {'banner_type': 'image', 'title': 'Needs a file'},
        ):
            self.assertEqual(self.staff.post(self.admin_url, fields, format='json').status_code, 400)

        text = self.staff.post(self.admin_url, {
            'title': 'Holiday hours', 'subtitle': 'Support is available until 6 pm.',
            'banner_type': 'text', 'theme_preset': 'indigo', 'badge_text': 'ANNOUNCEMENT',
            'target_type': 'support_chat', 'sort_order': 2,
        }, format='json')
        self.assertEqual(text.status_code, 201, text.data)
        self.assertIsNone(text.data['image_url'])
        url = self.admin_url + f"{text.data['id']}/"
        updated = self.staff.patch(url, {'theme_preset': 'crimson', 'badge_text': 'NOTICE'}, format='multipart')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['theme_preset'], 'crimson')
        self.assertEqual(updated.data['badge_text'], 'NOTICE')
        admin = self.staff.get(self.admin_url).data['banners']
        feed = self.mobile.get(self.feed_url).data['banners']
        for banners in (admin, feed):
            self.assertEqual([b['banner_type'] for b in banners], ['text', 'image'])
            self.assertEqual(banners[0]['badge_text'], 'NOTICE')
            self.assertIsNone(banners[0]['image_url'])
        self.assertEqual(self.staff.get(url + 'image/').status_code, 404)
        self.assertEqual(self.staff.delete(url).status_code, 204)

    def test_converting_an_image_banner_to_text_removes_its_file(self):
        created = self.upload()
        row = DealerBanner.objects.get(pk=created.data['id'])
        path = row.image.name
        url = self.admin_url + f'{row.pk}/'
        with self.captureOnCommitCallbacks(execute=True):
            converted = self.staff.patch(url, {'banner_type': 'text'}, format='json')
        self.assertEqual(converted.status_code, 200, converted.data)
        self.assertIsNone(converted.data['image_url'])
        self.assertFalse(row.image.storage.exists(path))
        self.assertEqual(self.staff.patch(url, {'banner_type': 'image'}, format='json').status_code, 400)
        restored = self.staff.patch(url, {
            'image': SimpleUploadedFile('new.png', self.png_bytes(), 'image/png'),
        }, format='multipart')
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.data['banner_type'], 'image')
        self.assertTrue(restored.data['image_url'])

    @staticmethod
    def png_bytes():
        contents = BytesIO()
        Image.new('RGB', (160, 90), '#ace2c7').save(contents, 'PNG')
        return contents.getvalue()
