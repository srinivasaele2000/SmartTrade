from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import FileSystemStorage
from django.test import TestCase, override_settings
from PIL import Image
import pymupdf
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from rest_framework.test import APIClient

from catalogue.extraction import normalize_item_name
from catalogue.models import Brand, BrandCategory, CatalogueDocument, Category, DraftCatalogueItem, ProductMedia
from catalogue.services.pdf_item_extractor import (
    Candidate, clean_extracted_name, extract_items, item_name, matching_image,
    strip_leading_category_banner,
)
from catalogue.test_catalogue_layout import parallel_price_list
from companies.models import CompanyProfile
from companies.tests import grant_staff_permissions, make_account


def sample_pdf(first_name='Modular Switch 6 A', first_category='Electrical', first_code='SW-001', *, second_photo=True):
    stream = BytesIO()
    pdf = canvas.Canvas(stream)
    pdf.setFont('Helvetica-Bold', 13)
    pdf.drawString(35, 775, 'Switchgear Price List - Sample Catalogue')
    pdf.setFont('Helvetica', 9)
    edges = (35, 95, 240, 320, 375, 455, 555)
    for x in edges:
        pdf.line(x, 604, x, 745)
    for y in (745, 714, 659, 604):
        pdf.line(edges[0], y, edges[-1], y)
    for index, heading in enumerate(('Image', 'Product Name', 'Product Code', 'HSN', 'Unit Price', 'Category')):
        pdf.drawString(edges[index] + 5, 726, heading)
    for y, colour, values in [
        (685, 'red', (first_name, first_code, '8536', '125.50', first_category)),
        (630, 'blue', ('Modular Socket 16 A', 'SO-002', '8536', '1,250.00', 'Electrical')),
    ]:
        image = Image.new('RGB', (28, 28), colour)
        if colour == 'blue' and second_photo:
            pdf.drawInlineImage(image, 47, y-12, 28, 28)
        elif colour == 'red':
            pdf.drawImage(ImageReader(image), 47, y-12, 28, 28)
        for index, value in enumerate(values, 1):
            for line_number, line in enumerate(value.split('\n')):
                pdf.drawString(edges[index] + 5, y - 11 * line_number, line)
    pdf.save()
    return stream.getvalue()


def section_price_list(ruled, sections=('ZEN SWITCH', 'DURA SWITCH')):
    stream = BytesIO()
    pdf = canvas.Canvas(stream)
    edges = (35, 215, 295, 355, 435)
    for left, right, title in zip(edges, edges[1:], ('Description', 'Code', 'HSN', 'Unit Price')):
        pdf.rect(left, 720, right-left, 20)
        pdf.drawString(left+4, 726, title)
    for top, section, name, code in (
        (720, sections[0], '1 0 A X,1 Way 1 M', 'ZEN-01'),
        (680, sections[1], '16 A X 2 Way 2 M', 'DURA-01'),
    ):
        pdf.rect(edges[0], top-16, edges[-1]-edges[0], 16, stroke=int(ruled), fill=1)
        pdf.setFillColorRGB(1, 1, 1)
        pdf.drawCentredString(235, top-12, section)
        pdf.setFillColorRGB(0, 0, 0)
        for left, right, value in zip(edges, edges[1:], (name, code, '8536', '125.50')):
            if ruled:
                pdf.rect(left, top-40, right-left, 24)
            pdf.drawString(left+4, top-32, value)
    pdf.save()
    return stream.getvalue()


def side_panel_price_list():
    stream = BytesIO()
    pdf = canvas.Canvas(stream)
    pdf.setFont('Helvetica', 8)
    edges = (140, 230, 330, 385, 455)
    for left, right, title, value in zip(edges, edges[1:], ('Code', 'Description', 'HSN', 'Unit Price'),
                                         ('68001', '6A Switch', '85361010', '39')):
        pdf.rect(left, 720, right - left, 20)
        pdf.drawString(left + 4, 726, title)
        pdf.drawString(left + 4, 700, value)
    pdf.drawImage(ImageReader(Image.new('RGB', (28, 28), 'green')), 52, 753, 28, 28)
    pdf.drawCentredString(66, 741, '68001')
    pdf.save()
    return stream.getvalue()


@override_settings(DEBUG=True)
class CatalogueExtractionTests(TestCase):
    def test_scanned_merged_image_spans_three_variant_rows(self):
        from catalogue.services.catalogue_ocr import TextBox
        from catalogue.services.pdf_item_extractor import ocr_rows

        with pymupdf.open() as document:
            page = document.new_page(width=400, height=300)
            page.draw_rect(pymupdf.Rect(35, 90, 66, 160), color=None, fill=(0.8, 0.1, 0.2))
            boxes = [TextBox(x, 40, x + 20, 50, label)
                     for x, label in ((30, 'Image'), (95, 'Description'), (200, 'Code'), (280, 'MRP'))]
            for index, y in enumerate((95, 120, 145, 205)):
                boxes.extend(TextBox(x, y, x + 20, y + 8, value)
                             for x, value in ((95, '10A Switch'), (200, f'SW-{index}'), (280, '20.00')))
            rows = ocr_rows(document, page, boxes, 1, 'INFINITY')
        self.assertEqual(len(rows), 4)
        self.assertTrue(rows[0].image)
        self.assertEqual([row.image for row in rows], [rows[0].image] * 3 + [None])

    def test_side_panel_matches_noisy_and_shared_base_codes(self):
        from catalogue.services.scanned_thumbnails import matching_caption

        captions = {'1NF101': {'first photo'}, 'INF202': {'second photo'}, 'SW00': {'third photo'}}
        self.assertEqual(matching_caption('INF-101', captions), 'first photo')
        self.assertEqual(matching_caption('INF-202W', captions), 'second photo')
        self.assertEqual(matching_caption('SW-OO', captions), 'third photo')
        self.assertIsNone(matching_caption('INF-203G', captions))
        self.assertIsNone(matching_caption('INF-101', {'1NF101': {'one'}, 'LNF101': {'two'}}))

    def setUp(self):
        folder = self.enterContext(TemporaryDirectory())
        self.root = Path(folder)
        self.enterContext(override_settings(CATALOGUE_MEDIA_ROOT=self.root))
        for model, field in [(CatalogueDocument, 'file'), (DraftCatalogueItem, 'image')]:
            self.enterContext(patch.object(model._meta.get_field(field), 'storage', FileSystemStorage(location=folder)))
        self.content = sample_pdf()
        self.document = CatalogueDocument.objects.create(
            business_type='ELECTRICAL', brand_name='Fixture', title='Switchgear Price List',
            file=ContentFile(self.content, name='sample.pdf'), filename='sample.pdf',
            content_type='application/pdf', file_size_bytes=len(self.content),
        )
        owner = make_account('+919800000081', 'COMPANY')
        company = CompanyProfile.objects.create(owner_account=owner, legal_name='Fixture company',
            company_email='fixture@example.test', verification_state='VERIFIED')
        self.association = BrandCategory.objects.create(brand=Brand.objects.create(company=company, name='Fixture'),
            category=Category.objects.create(name='Electrical'))
        staff = make_account('+919800000082', 'STAFF')
        grant_staff_permissions(staff, ['MODERATE_PRODUCTS'])
        self.client = APIClient()
        self.client.force_authenticate(staff)
        self.base = f'/api/v1/admin/catalogues/{self.document.key}/'

    def test_spatial_matching_and_two_distinct_thumbnail_rows(self):
        row = (0, 100, 300, 150)
        inside = {'bbox': (0, 110, 50, 130)}
        self.assertIs(matching_image(row, [{'bbox': (0, 140, 50, 190)}, inside]), inside)
        self.assertIsNone(matching_image(row, [inside, {'bbox': (60, 110, 80, 130)}]))
        parsed = extract_items(self.content)
        self.assertEqual([row.product_code for row in parsed], ['SW-001', 'SO-002'])
        colours = []
        for row in parsed:
            with Image.open(BytesIO(row.image)) as thumbnail:
                colours.append(thumbnail.getpixel((0, 0)))
        self.assertEqual(colours, [(255, 0, 0), (0, 0, 255)])

    def test_extracts_photo_captioned_by_item_code_outside_the_price_table(self):
        row, = extract_items(side_panel_price_list())
        self.assertEqual(row.product_code, '68001')
        with Image.open(BytesIO(row.image)) as thumbnail:
            self.assertEqual(thumbnail.getpixel((0, 0)), (0, 128, 0))

    def test_name_cleanup_preserves_word_boundaries(self):
        for raw, expected in [
            ('1 1 0 M AX', '10AX 1M'),
            ('1 0 A X,1 Way', '10AX, 1 Way'),
            ('10AX1 Way S W I T C H', '10AX 1 Way SWITCH'),
            ('16 A X 2 Way 2 M', '16AX 2 Way 2M'),
            ('20 A / 25 A, White', '20A / 25A, White'),
            ('A B switch 1 Way 1,000 units', 'A B switch 1 Way 1,000 units'),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(clean_extracted_name(raw), expected)
        self.assertEqual(item_name('Zen Switch 10AX 1 Way', 'ZEN SWITCH'), 'Zen Switch 10AX 1 Way')

    def test_active_section_prefixes_grid_and_unruled_names(self):
        for ruled in (True, False):
            with self.subTest(ruled=ruled):
                rows = extract_items(section_price_list(ruled))
                self.assertEqual([row.name for row in rows], [
                    'ZEN SWITCH 10AX, 1 Way 1M', 'DURA SWITCH 16AX 2 Way 2M',
                ])

    def test_generic_banners_set_category_without_prefixing_name(self):
        for ruled in (True, False):
            for family_hint in ('', 'ZIVA'):
                with self.subTest(ruled=ruled, family_hint=family_hint):
                    sections = ('MODULAR SWITCHES & SOCKETS', 'FAN REGULATORS')
                    rows = extract_items(section_price_list(ruled, sections), family_hint=family_hint)
                    prefix = f'{family_hint} ' if family_hint else ''
                    self.assertEqual([(row.name, row.category) for row in rows], [
                        (prefix + '10AX, 1 Way 1M', sections[0]),
                        (prefix + '16AX 2 Way 2M', sections[1]),
                    ])

    def test_description_cell_can_contain_a_leading_category_banner(self):
        for raw, expected, category in (
            ('SWITCHES 6A, 1 Way Switch', 'ZIVA 6A, 1 Way Switch', 'SWITCHES'),
            ('Dimmers & Regulators: Rotary', 'ZIVA Rotary', 'DIMMERS & REGULATORS'),
            ('6A Bell Push Switch', 'ZIVA 6A Bell Push Switch', ''),
        ):
            with self.subTest(raw=raw):
                row = extract_items(sample_pdf(raw, ''), family_hint='ZIVA')[0]
                self.assertEqual(row.name, expected)
                self.assertEqual(row.category, category)

    def test_category_prefix_is_stripped_with_or_without_family(self):
        for separator in (' ', '\n', '\t', ':', ',', '-', '–', '—'):
            with self.subTest(separator=separator):
                raw = f'Switches{separator}Rotary switch'
                self.assertEqual(strip_leading_category_banner(raw), ('Rotary switch', 'SWITCHES'))
                self.assertEqual(item_name(raw, ''), 'Rotary switch')
                self.assertEqual(item_name(raw, 'ZIVA'), 'ZIVA Rotary switch')
                self.assertEqual(item_name(raw, 'SWITCHES'), 'Rotary switch')
        self.assertEqual(item_name('SwitchesPlus 6A', ''), 'SwitchesPlus 6A')

    def test_names_keep_adjacent_columns_and_wrapped_lines_separate(self):
        for ruled in (True, False):
            with self.subTest(ruled=ruled):
                stream = BytesIO()
                pdf = canvas.Canvas(stream)
                edges = (35, 90, 145, 290, 345, 405, 470)
                titles = ('Code', 'Rating', 'Description', 'Module', 'HSN', 'Unit Price')
                values = ('68001', '6 A', 'ZIVA 1Way Switch', '1 Module', '85361010', '39')
                pdf.setFont('Helvetica', 8)
                # Paint the lower line first, only 1.5 pt below the upper line
                # at the same x-position. The word boxes overlap.
                pdf.drawString(edges[2] + 3, 707.5, '100W SBL Load')
                for left, right, title, value in zip(edges, edges[1:], titles, values):
                    pdf.rect(left, 720, right - left, 20)
                    pdf.drawString(left + 3, 726, title)
                    if ruled:
                        pdf.rect(left, 696, right - left, 24)
                    pdf.drawString(left + 3, 709, value)
                pdf.save()

                rows = extract_items(stream.getvalue(), family_hint='ZIVA')
                self.assertEqual([(row.product_code, row.name) for row in rows], [
                    ('68001', 'ZIVA 6A 1 Way Switch 100W SBL Load 1M'),
                ])

    def test_extracts_items_beyond_page_sixty(self):
        with pymupdf.open() as document, pymupdf.open(stream=self.content, filetype='pdf') as source:
            for _ in range(64):
                document.new_page()
            document.insert_pdf(source)
            content = document.tobytes()
        with patch('catalogue.services.pdf_item_extractor.read_page') as ocr:
            self.assertEqual([(row.page, row.product_code) for row in extract_items(content)],
                             [(65, 'SW-001'), (65, 'SO-002')])
        ocr.assert_not_called()

    def test_page_batches_append_deduplicate_and_validate_ranges(self):
        with pymupdf.open() as document:
            for code in ('PAGE-1', 'PAGE-2', 'PAGE-3'):
                with pymupdf.open(stream=sample_pdf(first_code=code), filetype='pdf') as source:
                    document.insert_pdf(source)
            self.document.file.save('pages.pdf', ContentFile(document.tobytes()))
        url = self.base + 'extract/'
        self.assertEqual(self.client.get(url).data['rows'], [])
        first = self.client.post(url, {'start_page': ' ', 'end_page': 1}, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        first_rows = first.data['rows']
        self.assertEqual({row['page'] for row in first_rows}, {1})
        second = self.client.post(url, {'start_page': 2, 'end_page': 3, 'append': True}, format='json')
        self.assertEqual(second.status_code, 200, second.data)
        rows = second.data['rows']
        self.assertEqual(rows[:len(first_rows)], first_rows)
        self.assertEqual([(row['page'], row['product_code']) for row in rows],
                         [(1, 'PAGE-1'), (1, 'SO-002'), (2, 'PAGE-2'), (3, 'PAGE-3')])
        self.assertEqual(self.client.post(url, {'start_page': 2, 'append': True}, format='json').data['rows'], rows)
        self.assertEqual(self.client.get(url).data['rows'], rows)
        for data, message in (
            ({'start_page': 3, 'end_page': 2}, 'The end page must be at or after the start page.'),
            ({'start_page': 2, 'end_page': 4}, "Page range 2-4 exceeds the PDF's 3 pages."),
        ):
            self.assertContains(self.client.post(url, data, format='json'), message, status_code=400)
        self.assertEqual(self.client.get(url).data['rows'], rows)
        replaced = self.client.post(url, {'start_page': 2, 'end_page': 3}, format='json')
        self.assertEqual(replaced.status_code, 200, replaced.data)
        self.assertEqual([row['page'] for row in replaced.data['rows']], [2, 2, 3, 3])

    def test_timed_partial_batch_saves_completed_pages_and_preserves_existing_drafts(self):
        with pymupdf.open(stream=self.content, filetype='pdf') as source, pymupdf.open() as document:
            document.insert_pdf(source)
            document.insert_pdf(source)
            self.document.file.save('partial.pdf', ContentFile(document.tobytes()))
        existing = self.document.draft_items.create(page=2, product_code='EXISTING', name='Existing draft')
        with patch('catalogue.services.pdf_item_extractor.monotonic', side_effect=[0, 0, 151]):
            response = self.client.post(self.base + 'extract/', {'append': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['batch'], {
            'start_page': 1, 'end_page': 2, 'processed_through': 1, 'added': 2,
        })
        self.assertTrue(self.document.draft_items.filter(pk=existing.pk).exists())

    def test_multi_column_drafts_keep_pack_metadata_and_last_extraction_details(self):
        self.document.file.save('parallel.pdf', ContentFile(parallel_price_list(2)))
        result = self.client.post(self.base + 'extract/')
        self.assertEqual(result.status_code, 200, result.data)
        first = result.data['rows'][0]
        self.assertEqual(first['hsn_sac_code'], '39172390')
        self.assertEqual(first['pack_size'], {'standard': '10', 'box_quantity': '100'})
        self.assertEqual(result.data['diagnostics']['product_sections'], 2)
        self.assertEqual(result.data['diagnostics']['items_extracted'], 4)
        self.assertEqual(self.client.get(self.base + 'extract/').data['diagnostics'], result.data['diagnostics'])
        committed = self.client.post(self.base + 'drafts/commit/', {'rows': [{
            'id': first['id'], 'approved': True, 'name': first['name'], 'product_code': first['product_code'],
            'hsn_sac_code': first['hsn_sac_code'], 'price_per_unit': first['price_per_unit'],
            'brand_category': self.association.pk,
        }]}, format='json')
        self.assertEqual(committed.status_code, 201, committed.data)
        draft = DraftCatalogueItem.objects.get(pk=first['id'])
        self.assertEqual(draft.product.specifications['Pack size'], first['pack_size'])

    def test_empty_batch_records_warning_and_preserves_drafts(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream)
        pdf.drawString(30, 750, 'Prices: Available on Request')
        pdf.save()
        self.document.file.save('unpriced.pdf', ContentFile(stream.getvalue()))
        draft = self.document.draft_items.create(page=1, product_code='EXISTING', name='Existing draft')

        result = self.client.post(self.base + 'extract/', {'append': False}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        diagnostics = result.data['diagnostics']
        self.assertEqual(diagnostics['status'], 'no_items')
        self.assertEqual(diagnostics['skipped_pages'], [{'page': 1, 'reason': 'prices_on_request'}])
        self.assertTrue(diagnostics['warnings'])
        self.assertEqual([row['id'] for row in result.data['rows']], [draft.pk])

    def test_extracts_image_only_page_with_filename_prefix(self):
        with pymupdf.open(stream=sample_pdf(first_code='SW-001/A', second_photo=False), filetype='pdf') as source, pymupdf.open() as scanned:
            original = source[0]
            page = scanned.new_page(width=original.rect.width, height=original.rect.height)
            page.insert_image(page.rect, pixmap=original.get_pixmap(dpi=220))
            self.assertEqual(page.get_text().strip(), '')
            content = scanned.tobytes(deflate=True)
        self.document.filename = 'Infinity.pdf'
        self.document.file.save('scan.pdf', ContentFile(content))
        response = self.client.post(self.base + 'extract/')
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data['rows']
        self.assertEqual([row['product_code'] for row in rows], ['SW-001/A', 'SO-002'])
        self.assertEqual([row['name'] for row in rows], ['INFINITY Modular Switch 6A', 'INFINITY Modular Socket 16A'])
        self.assertEqual([row['hsn_sac_code'] for row in rows], ['8536', '8536'])
        self.assertEqual([row['price_per_unit'] for row in rows], ['125.5000', '1250.0000'])
        self.assertTrue(rows[0]['image_url'])
        self.assertIsNone(rows[1]['image_url'])
        preview = self.client.get(rows[0]['image_url'])
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview['Content-Type'], 'image/png')
        with Image.open(BytesIO(b''.join(preview.streaming_content))) as cropped:
            self.assertEqual((cropped.format, cropped.mode), ('PNG', 'RGB'))
            self.assertGreaterEqual(min(cropped.size), 32)
            red, green, blue = cropped.getpixel((cropped.width // 2, cropped.height // 2))
            self.assertGreater(red, green + blue)

    def test_extracts_owner_restricted_pdf_with_empty_user_password(self):
        with pymupdf.open(stream=self.content, filetype='pdf') as document:
            content = document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                                       owner_pw='owner-secret', user_pw='', permissions=0)
        self.assertEqual([row.product_code for row in extract_items(content)], ['SW-001', 'SO-002'])

    def test_api_reports_specific_pdf_validation_failures(self):
        with pymupdf.open() as document:
            document.new_page()
            no_text = document.tobytes()
            for _ in range(250):
                document.new_page()
            too_many_pages = document.tobytes()
        with pymupdf.open(stream=self.content, filetype='pdf') as document:
            locked = document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                                      owner_pw='owner-secret', user_pw='user-secret')
        for content, message in (
            (too_many_pages, 'This PDF has 251 pages, which exceeds the 250-page limit.'),
            (locked, 'This PDF is password-protected. Upload an unlocked PDF.'),
            (b'%PDF-invalid', 'Could not read this PDF file. Please verify the file is a valid PDF.'),
            (no_text, 'This PDF contains no selectable or OCR-readable text.'),
        ):
            with self.subTest(message=message):
                self.document.file.save('validation.pdf', ContentFile(content))
                response = self.client.post(self.base + 'extract/')
                self.assertContains(response, message, status_code=400)
        self.assertFalse(self.document.draft_items.exists())

    def test_reextraction_replaces_stale_draft_and_preserves_reviewed_rows(self):
        self.document.title = 'ZIVA'
        self.document.filename = 'Ziva.pdf'
        self.document.file.save('ziva.pdf', ContentFile(sample_pdf('SWITCHES 6A, 1 Way Switch', '', '68001')))
        stale = self.document.draft_items.create(page=1, product_code='68001', name='SWITCHES stale name')
        stale.image.save('old.png', ContentFile(b'old thumbnail'))
        reviewed = self.document.draft_items.create(page=1, product_code='SO-002', name='Reviewed socket',
                                                    status=DraftCatalogueItem.Status.DISCARDED)
        with patch('catalogue.services.pdf_item_extractor.EXTRACTION_BUDGET_SECONDS', 0):
            response = self.client.post(self.base + 'extract/')
            self.assertContains(response, 'Extraction took too long.', status_code=400)
        self.assertTrue(self.document.draft_items.filter(pk=stale.pk).exists())

        with self.captureOnCommitCallbacks(execute=True):
            result = self.client.post(self.base + 'extract/')
        self.assertEqual(result.status_code, 200, result.data)
        fresh = self.document.draft_items.get(product_code='68001')
        self.assertEqual((fresh.name, fresh.category, fresh.status),
                         ('ZIVA 6A, 1 Way Switch', 'SWITCHES', DraftCatalogueItem.Status.DRAFT))
        self.assertNotEqual(fresh.pk, stale.pk)
        self.assertFalse((self.root / stale.image.name).exists())
        self.assertEqual([row['id'] for row in result.data['rows']], [reviewed.pk, fresh.pk])

    def test_persistence_normalizer_prefers_a_direct_banner_over_an_inferred_family(self):
        for raw, expected in (
            ('SWITCHES 6A, 1 Way Switch', ('6A, 1 Way Switch', 'SWITCHES')),
            ('SWITCHES SOCKETS 6A', ('6A', 'SWITCHES')),
            ('ZIVA SWITCHES 6A', ('ZIVA 6A', 'SWITCHES')),
            ('ZIVA DIMMERS & REGULATORS: Rotary', ('ZIVA Rotary', 'DIMMERS & REGULATORS')),
            (None, ('', None)),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_item_name(raw), expected)

    def test_draft_persistence_strips_banners_and_keeps_one_family_prefix(self):
        self.document.title = 'ZIVA'
        self.document.filename = 'Ziva.pdf'
        self.document.save(update_fields=['title', 'filename'])
        expected = 'ZIVA 6A, 1 Way Switch, 1M (ISI) 100W SBL Load'
        for name in (
            expected, 'SWITCHES: ' + expected, 'SWITCHES\nSWITCHES ' + expected[5:],
            'ZIVA SWITCHES: ' + expected[5:],
        ):
            with self.subTest(name=name):
                candidate = Candidate(4, name, '68001', '85361010', None, '')
                with patch('catalogue.services.pdf_item_extractor.extract_items', return_value=[candidate]):
                    response = self.client.post(self.base + 'extract/')
                self.assertEqual(response.status_code, 200, response.data)
                draft = self.document.draft_items.get(product_code='68001')
                self.assertEqual(draft.name, expected)
                self.assertEqual(draft.category, '' if name == expected else 'SWITCHES')

    def test_upload_filename_controls_extracted_family_prefix(self):
        description = '(ISI) 16AX, 1 Way Switch, 1M\n200W SBL Load'
        for filename, title, raw, expected_prefix in (
            ('Penta Modular.pdf', 'PENTA MODULE', description, 'PENTA MODULAR'),
            ('Roma_Urban.pdf', 'ROMA URBAN BRAND', description, 'ROMA URBAN'),
            ('Roma--Urban.PDF', 'ROMA URBAN BRAND', 'roma-urban\n' + description, 'ROMA URBAN'),
            ('_- .pdf', ' Ziva  Series ', description, 'ZIVA SERIES'),
        ):
            with self.subTest(filename=filename):
                self.document.filename = filename
                self.document.title = title
                self.document.file.save('fixture.pdf', ContentFile(sample_pdf(raw, '', '68001')))
                response = self.client.post(self.base + 'extract/')
                self.assertEqual(response.status_code, 200, response.data)
                draft = self.document.draft_items.get(product_code='68001')
                self.assertEqual(draft.name, f'{expected_prefix} ' + description.replace('\n', ' '))

    def test_filename_family_takes_precedence_over_table_sections(self):
        for ruled in (True, False):
            with self.subTest(ruled=ruled):
                first, _ = extract_items(section_price_list(ruled), family_hint='PENTA MODULAR')
                self.assertEqual(first.name, 'PENTA MODULAR 10AX, 1 Way 1M')

    def test_staff_can_add_replace_and_clear_a_draft_photo(self):
        draft = self.document.draft_items.create(page=8, product_code='68980', name='Switch')
        url = self.base + f'drafts/{draft.pk}/image/'

        def upload(colour, image_format):
            output = BytesIO()
            Image.new('RGB', (900, 700), colour).save(output, image_format)
            extension = 'jpg' if image_format == 'JPEG' else 'png'
            return SimpleUploadedFile(f'photo.{extension}', output.getvalue(),
                                      content_type=f'image/{image_format.lower()}')

        self.assertEqual(APIClient().post(url, {'image': upload('red', 'PNG')}, format='multipart').status_code, 401)
        invalid = SimpleUploadedFile('bad.png', b'not an image', content_type='image/png')
        self.assertEqual(self.client.post(url, {'image': invalid}, format='multipart').status_code, 400)
        added = self.client.post(url, {'image': upload('red', 'JPEG')}, format='multipart')
        self.assertEqual(added.status_code, 200, added.data)
        draft.refresh_from_db()
        old_path = self.root / draft.image.name
        with Image.open(old_path) as photo:
            self.assertEqual((photo.format, photo.width), ('PNG', 640))
        with self.captureOnCommitCallbacks(execute=True):
            replaced = self.client.post(url, {'image': upload('blue', 'PNG')}, format='multipart')
        self.assertEqual(replaced.status_code, 200, replaced.data)
        self.assertNotEqual(added.data['image_url'], replaced.data['image_url'])
        self.assertFalse(old_path.exists())
        preview = self.client.get(replaced.data['image_url'])
        with Image.open(BytesIO(b''.join(preview.streaming_content))) as photo:
            self.assertEqual(photo.getpixel((0, 0)), (0, 0, 255, 255))
        draft.refresh_from_db()
        replacement_path = self.root / draft.image.name
        with self.captureOnCommitCallbacks(execute=True):
            cleared = self.client.delete(url)
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.data['image_url'])
        self.assertFalse(replacement_path.exists())
        self.assertEqual(self.client.get(url).status_code, 404)
        draft.status = DraftCatalogueItem.Status.DISCARDED
        draft.save(update_fields=['status'])
        self.assertEqual(self.client.post(url, {'image': upload('red', 'PNG')}, format='multipart').status_code, 409)
        self.assertEqual(self.client.delete(url).status_code, 409)

    def test_upload_extract_review_commit_and_file_preservation(self):
        self.document.brand_name = 'ANCHOR'
        self.document.save(update_fields=['brand_name'])
        self.association.brand.name = 'Anchor by Panasonic'
        self.association.brand.save(update_fields=['name'])
        anon = APIClient()
        self.assertEqual(anon.post(self.base + 'extract/').status_code, 401)
        self.assertEqual(anon.get('/api/v1/catalogue/items/').data['count'], 0)
        result = self.client.post(self.base + 'extract/')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual([option['id'] for option in result.data['categories']], [self.association.pk])
        rows = result.data['rows']
        self.assertEqual(len(rows), 2)
        draft = DraftCatalogueItem.objects.get(pk=rows[0]['id'])
        self.assertTrue(draft.image.name.startswith('catalogue/products/extracted/'))
        self.assertTrue((self.root / draft.image.name).is_file())
        self.assertEqual(anon.get(rows[0]['image_url']).status_code, 401)
        preview = self.client.get(rows[0]['image_url'])
        self.assertEqual(b''.join(preview.streaming_content), (self.root / draft.image.name).read_bytes())
        self.assertEqual(anon.get('/api/v1/catalogue/items/').data['count'], 0)
        payload = {'rows': [
            {'id': draft.pk, 'approved': True, 'name': 'Reviewed switch', 'product_code': rows[0]['product_code'],
             'hsn_sac_code': rows[0]['hsn_sac_code'], 'price_per_unit': rows[0]['price_per_unit'],
             'brand_category': self.association.pk},
            {'id': rows[1]['id'], 'approved': False},
        ]}
        committed = self.client.post(self.base + 'drafts/commit/', payload, format='json')
        self.assertEqual(committed.status_code, 201, committed.data)
        self.assertEqual(committed.data['items'][0]['name'], 'Reviewed switch')
        self.assertEqual(committed.data['items'][0]['price_per_unit'], '125.5000')
        self.assertEqual(committed.data['items'][0]['hsn_sac_code'], '8536')
        media = ProductMedia.objects.get()
        self.assertEqual((self.root / media.storage_name).read_bytes(), (self.root / draft.image.name).read_bytes())
        self.assertEqual(DraftCatalogueItem.objects.get(pk=rows[1]['id']).status, 'DISCARDED')
        self.assertEqual(anon.get('/api/v1/catalogue/items/').data['count'], 1)
        self.assertEqual(self.client.post(self.base + 'drafts/commit/', payload, format='json').status_code, 409)
