from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
from rest_framework.test import APIClient

from companies.tests import grant_staff_permissions, make_account
from .models import CatalogueDocument


class CatalogueVaultTests(TestCase):
    public = '/api/v1/catalogues/'
    staff = '/api/v1/admin/catalogues/'

    def setUp(self):
        self.client = APIClient()
        self.temp = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.object(CatalogueDocument._meta.get_field('file'), 'storage',
                                       FileSystemStorage(location=self.temp)))
        self.moderator = make_account('+919800000081', 'STAFF')

    def upload(self, file, business_type='NETWORKING', **fields):
        return self.client.post(self.staff, {'file': file, 'business_type': business_type,
                                             'brand_name': 'Disposable brand', 'title': 'Catalogue sheet', **fields})

    def test_pdf_filter_download_and_soft_delete(self):
        buffer = BytesIO()
        pdf = Canvas(buffer)
        pdf.drawString(20, 100, 'Disposable PDF')
        pdf.save()
        content = buffer.getvalue()
        file = SimpleUploadedFile('example.pdf', content, content_type='application/pdf')
        self.assertEqual(self.upload(file).status_code, 401)
        self.client.force_authenticate(self.moderator)
        self.assertEqual(self.upload(file).status_code, 403)
        grant_staff_permissions(self.moderator, ['MODERATE_PRODUCTS'])
        file.seek(0)
        response = self.upload(file)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['file_size_bytes'], len(content))
        item = CatalogueDocument.objects.get()
        self.assertTrue((Path(self.temp) / item.file.name).is_file())
        anonymous = APIClient()
        self.assertEqual(anonymous.get(self.public + '?business_type=ELECTRICAL').data['count'], 0)
        self.assertEqual(anonymous.get(self.public + '?business_type=INVALID').status_code, 400)
        result = anonymous.get(self.public + '?business_type=NETWORKING').data['results'][0]
        served = anonymous.get(result['download_url'])
        self.assertEqual(b''.join(served.streaming_content), content)
        self.assertIn('attachment', served['Content-Disposition'])
        self.assertEqual(anonymous.get(response.data['download_url']).status_code, 401)
        self.assertEqual(self.client.delete(f'{self.staff}{item.key}/').status_code, 204)
        retained = self.client.get(response.data['download_url'])
        self.assertEqual(retained.status_code, 200)
        self.assertEqual(b''.join(retained.streaming_content), content)
        self.assertFalse(self.client.get(self.staff).data['results'][0]['is_active'])
        self.assertEqual(anonymous.get(result['download_url']).status_code, 404)
        self.assertEqual(anonymous.get(self.public).data['count'], 0)

    def test_accepts_validated_images_and_rejects_unrecognized_content(self):
        grant_staff_permissions(self.moderator, ['MODERATE_PRODUCTS'])
        self.client.force_authenticate(self.moderator)
        self.assertEqual(self.upload(SimpleUploadedFile('bad.png', b'not an image', 'image/png')).status_code, 400)
        self.assertEqual(self.upload(SimpleUploadedFile('bad.pdf', b'%PDF-1.7', 'application/pdf')).status_code, 400)
        buffer = BytesIO()
        Image.new('RGB', (64, 64), 'green').save(buffer, format='PNG')
        response = self.upload(SimpleUploadedFile('valid.png', buffer.getvalue(), 'image/png'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['content_type'], 'image/png')

    def test_sub_category_upload_validation_and_public_and_staff_filters(self):
        grant_staff_permissions(self.moderator, ['MODERATE_PRODUCTS'])
        self.client.force_authenticate(self.moderator)
        buffer = BytesIO()
        Image.new('RGB', (64, 64), 'green').save(buffer, format='PNG')

        def upload(business, **fields):
            return self.upload(SimpleUploadedFile('valid.png', buffer.getvalue(), 'image/png'), business, **fields)

        self.assertEqual(upload('ELECTRICAL', sub_category='PIPES_FITTINGS').status_code, 400)
        self.assertEqual(upload('ELECTRICAL').data['sub_category'], '')
        response = upload('ELECTRICAL', sub_category='WIRES_CABLES')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['sub_category'], 'WIRES_CABLES')
        self.assertEqual(upload('CONSTRUCTION_STEEL', sub_category='TMT_REBARS').status_code, 201)
        filters = '?business_type=ELECTRICAL&sub_category=WIRES_CABLES'
        anonymous = APIClient()
        for client, url in [(anonymous, self.public), (self.client, self.staff)]:
            rows = client.get(url + filters).data['results']
            self.assertEqual([row['key'] for row in rows], [response.data['key']])
            self.assertEqual(client.get(url + '?business_type=PLUMBING&sub_category=WIRES_CABLES').status_code, 400)
        self.assertEqual(anonymous.get(self.public + '?sub_category=TMT_REBARS').data['count'], 1)

    def test_staff_edit_moves_public_document_without_replacing_file(self):
        grant_staff_permissions(self.moderator, ['MODERATE_PRODUCTS'])
        self.client.force_authenticate(self.moderator)
        buffer = BytesIO()
        Image.new('RGB', (64, 64), 'green').save(buffer, format='PNG')
        uploaded = self.upload(SimpleUploadedFile('valid.png', buffer.getvalue(), 'image/png'),
                               'PLUMBING', sub_category='PIPES_FITTINGS')
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        item = CatalogueDocument.objects.get()
        file_name = item.file.name
        url = f'{self.staff}{item.key}/'
        data = {'business_type': 'ELECTRICAL', 'sub_category': 'WIRES_CABLES', 'title': 'Updated catalogue',
                'brand_name': 'Updated brand'}
        anonymous = APIClient()
        self.assertEqual(anonymous.patch(url, data, format='json').status_code, 401)
        self.assertEqual(self.client.patch(url, {'file': 'replacement'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'sub_category': 'WIRES_CABLES'}, format='json').status_code, 400)
        edited = self.client.patch(url, data, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
        for field, value in data.items():
            self.assertEqual(edited.data[field], value)
        self.assertEqual(anonymous.get(self.public + '?business_type=PLUMBING').data['count'], 0)
        results = anonymous.get(self.public + '?business_type=ELECTRICAL&sub_category=WIRES_CABLES').data['results']
        self.assertEqual([row['key'] for row in results], [edited.data['key']])
        served = anonymous.get(results[0]['download_url'])
        self.assertEqual(b''.join(served.streaming_content), buffer.getvalue())
        item.refresh_from_db()
        self.assertEqual(item.file.name, file_name)
        self.assertEqual(self.client.patch(url, {'title': 'Title only'}, format='json').data['sub_category'], 'WIRES_CABLES')
        self.assertEqual(self.client.patch(url, {'business_type': 'OTHER'}, format='json').data['sub_category'], '')
