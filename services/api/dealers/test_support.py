from io import BytesIO
from tempfile import TemporaryDirectory

from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from companies.tests import grant_staff_permissions, make_account
from .models import AdminSupportThread, TradeWorkerContact


class SupportTests(TestCase):
    dealer_path = '/api/v1/messages/dealer/'
    admin_path = '/api/v1/messages/admin/threads/'

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        settings = override_settings(MEDIA_ROOT=directory.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.dealer = make_account('+919800000071', 'BUSINESS')
        self.other = make_account('+919800000072', 'BUSINESS')
        for account in (self.dealer, self.other):
            business = account.business_profile
            business.legal_name = 'Northside Electricals'
            business.contacts_submitted_at = timezone.now()
            business.save()
            TradeWorkerContact.objects.bulk_create([
                TradeWorkerContact(business=business, name=f'Worker {i}', trade='Electrician',
                                   mobile_e164=f'+919800{account.pk % 1000:03}{i:03}',
                                   consent_confirmed_at=timezone.now())
                for i in range(10)
            ])
        self.staff = make_account('+919800000073', 'STAFF')
        grant_staff_permissions(self.staff, ['REVIEW_BUSINESS'])
        self.client = APIClient()
        self.client.force_authenticate(self.dealer)
        self.admin = APIClient()
        self.admin.force_authenticate(self.staff)

    def attachments(self):
        data = BytesIO()
        Image.new('RGB', (20, 20)).save(data, 'PNG')
        return (
            SimpleUploadedFile('photo.png', data.getvalue(), 'image/png'),
            SimpleUploadedFile('document.pdf', b'%PDF-1.4\n%%EOF\n', 'application/pdf'),
        )

    def test_two_way_messages_attachments_search_and_read_receipts(self):
        self.assertEqual(self.client.get(self.dealer_path + 'unread/').data['dealer_unread_count'], 0)
        self.assertFalse(AdminSupportThread.objects.exists())
        first = self.client.get(self.dealer_path + 'thread/')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['messages'], [])
        admin_thread = self.admin_path + f"{first.data['id']}/"
        for client, path, role in ((self.client, self.dealer_path, 'dealer'), (self.admin, admin_thread, 'admin')):
            for content in ({'body': 'Hello'}, *({'attachment': item} for item in self.attachments())):
                posted = client.post(path + 'messages/', content, format='multipart')
                self.assertEqual(posted.status_code, 201, posted.data)
                self.assertEqual(posted.data['sender_role'], role)
        for term in ('Northside', '9800000071'):
            inbox = self.admin.get(self.admin_path, {'q': term}).data
            self.assertEqual(inbox['count'], 1)
            self.assertEqual(inbox['total_unread'], 3)
        thread = self.admin.get(admin_thread).data
        self.assertEqual([m['attachment_type'] for m in thread['messages']], ['', 'image', 'pdf'] * 2)
        self.assertEqual(thread['dealer_unread_count'], 3)
        recent = self.admin.get(admin_thread, {'page_size': 2}).data
        before = recent['messages'][0]['id']
        self.assertTrue(recent['next'])
        self.client.post(self.dealer_path + 'messages/', {'body': 'Arrived after pagination'}, format='multipart')
        older = self.admin.get(admin_thread, {'before_id': before, 'page_size': 2}).data
        self.assertEqual([m['id'] for m in older['messages']], [m['id'] for m in thread['messages'][2:4]])
        for message in [thread['messages'][1], thread['messages'][5]]:
            response = self.client.get(self.dealer_path + f"attachments/{message['id']}/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
            self.assertTrue(b''.join(response.streaming_content))
        self.assertEqual(self.admin.post(admin_thread + 'mark-read/', {'through_id': thread['messages'][1]['id']}, format='json').status_code, 204)
        self.assertEqual(self.admin.get(self.admin_path).data['total_unread'], 2)
        self.assertEqual(self.admin.post(admin_thread + 'mark-read/', {}, format='json').status_code, 204)
        self.assertEqual(self.client.post(self.dealer_path + 'mark-read/', {}, format='json').status_code, 204)
        self.assertEqual(self.client.get(self.dealer_path + 'unread/').data['dealer_unread_count'], 0)
        self.assertEqual(self.admin.get(self.admin_path).data['total_unread'], 0)
        self.assertTrue(all(m['is_read'] for m in self.admin.get(admin_thread).data['messages']))

    def test_rejects_invalid_uploads_and_prevents_cross_account_access(self):
        for name, payload, mime in (
            ('exploit.html', b'<html>', 'text/html'), ('installer.exe', b'MZ', 'application/octet-stream'),
            ('wrong.png', b'%PDF-1.4\n%%EOF', 'image/png'), ('wrong.pdf', b'not a PDF', 'application/pdf'),
            ('large.pdf', b'0' * (10 * 1024 * 1024 + 1), 'application/pdf'),
        ):
            self.assertEqual(self.client.post(self.dealer_path + 'messages/', {
                'attachment': SimpleUploadedFile(name, payload, mime),
            }, format='multipart').status_code, 400)
        self.assertEqual(self.client.post(self.dealer_path + 'messages/', {'body': '  '}, format='json').status_code, 400)
        message = self.client.post(self.dealer_path + 'messages/', {'attachment': self.attachments()[0]}, format='multipart')
        self.assertEqual(message.status_code, 201)
        path = self.dealer_path + f"attachments/{message.data['id']}/"
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.get(self.dealer_path + 'thread/').data['messages'], [])
        self.assertEqual(self.client.get(self.admin_path).status_code, 403)
        self.assertEqual(APIClient().get(path).status_code, 401)
        self.admin.force_authenticate(make_account('+919800000074', 'STAFF'))
        self.assertEqual(self.admin.get(self.admin_path).status_code, 403)
        self.client.force_authenticate(make_account('+919800000075', 'BUSINESS'))
        denied = self.client.get(self.dealer_path + 'thread/')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data['code'], 'ONBOARDING_STEP_2_REQUIRED')
