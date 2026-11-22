from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from io import StringIO
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.files.storage import FileSystemStorage
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from PIL import Image
import pymupdf
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from rest_framework.test import APIClient

from catalogue.extraction import normalize_item_name
from catalogue.models import Brand, BrandCategory, CatalogueAudit, CatalogueDocument, Category, DraftCatalogueItem, Product, ProductMedia
from catalogue.services.pdf_item_extractor import (
    Candidate, clean_extracted_name, extract_items, item_name, matching_image, price,
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
    def test_flattened_gallery_attaches_split_caption_photos_to_existing_drafts(self):
        from catalogue.services.catalogue_ocr import TextBox

        codes = ('901101', '901102', '901103', '901104')
        boxes = [TextBox(x, 55, x + 28, 64, text) for x, text in
                 ((388, 'Pro. Code'), (475, 'Item'), (630, 'MRP'), (704, 'Std. Pkg.'))]
        for index, code in enumerate(codes):
            y = 95 + index * 30
            boxes.extend(TextBox(x, y, x + 36, y + 9, text) for x, text in
                         ((388, code), (475, 'Switch'), (630, '113'), (704, '10')))
        photos = [(52, '101', 'silver'), (154, '102', 'red'), (256, '104', 'blue')]
        image = Image.new('RGB', (790, 320), 'white')
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        for x, suffix, color in photos:
            draw.polygon([(x, 165), (x + 26, 155), (x + 29, 210), (x + 6, 220)] if suffix != '101'
                         else [(x, 36), (x + 22, 25), (x + 31, 202), (x + 12, 217)], fill=color)
            boxes.extend((TextBox(x, 228, x + 14, 236, '901'), TextBox(x + 24, 231, x + 39, 239, suffix)))
        stream = BytesIO()
        image.save(stream, format='PNG')
        with pymupdf.open() as scan:
            page = scan.new_page(width=790, height=320)
            page.insert_image(page.rect, stream=stream.getvalue())
            self.assertEqual(len(page.get_images()), 1)
            self.document.file.save('flat.pdf', ContentFile(scan.tobytes()))
        existing = self.document.draft_items.create(page=1, name='Staff edited', product_code='901 101')
        with patch('catalogue.services.pdf_item_extractor.read_page', return_value=boxes):
            response = self.client.post(self.base + 'extract/', {'append': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['diagnostics']['caption_skus_found'], 3)
        self.assertEqual(response.data['diagnostics']['cropped_thumbnails_attached'], 3)
        items = {item.product_code.replace(' ', ''): item for item in self.document.draft_items.all()}
        self.assertEqual(self.document.draft_items.count(), 4)
        self.assertEqual(set(items), set(codes))
        self.assertEqual(items['901101'].pk, existing.pk)
        self.assertEqual(items['901101'].name, 'Staff edited')
        self.assertFalse(items['901103'].image)
        for _, suffix, color in photos:
            with items['901' + suffix].image.open() as file, Image.open(file) as crop:
                self.assertEqual(crop.getpixel((crop.width // 2, crop.height // 2)), Image.new('RGB', (1, 1), color).getpixel((0, 0)))
                if suffix == '101':
                    self.assertGreater(crop.height, crop.width * 4)

    def test_split_page_ocr_persists_finish_mrps_pack_sizes_and_caption_photos(self):
        from catalogue.services.catalogue_ocr import TextBox
        from catalogue.services.catalogue_layout import native_boxes

        codes = ('901101', '901102', '901104', '901105', '901114', '901115', '901116', 'EF1001', 'EF1002')
        colors = ((210, 25, 30), (28, 160, 35), (26, 53, 202), (25, 153, 160), (140, 40, 145),
                  (230, 105, 27), (124, 68, 38), (71, 82, 99), (110, 48, 140))
        families = ('E-Square', 'E-Soft', 'E-Flat')
        titles = tuple(f'{family} 10AX/20A. Switches 240V~(1M)' for family in families)
        with pymupdf.open() as source:
            page = source.new_page(width=840, height=650)
            for index in (5, 2, 0, 7, 3, 6, 1, 8, 4):
                x = 35 + 110 * ((5 * index) % 9 % 3)
                y = 132 + 155 * ((5 * index) % 9 // 3)
                page.draw_rect((x, y - 67, x + 49, y - 14), color=None,
                               fill=tuple(channel / 255 for channel in colors[index]))
                code = codes[index]
                caption = code[:3] + ' ' + code[3:] if code.isdigit() else code
                page.insert_text((x + 3, y), caption, fontsize=9)
            for section, title in enumerate(titles):
                top = 63 + section * 155
                page.insert_text((389, top), title, fontsize=12)
                for x, label in ((389, ('Pro. Code', 'Pro Code', 'Prod. Code')[section]), (464, 'Item'),
                                 (598, 'Neo White'), (684, ('Grey/Black', 'Grey / Black', 'Grey/Black')[section]),
                                 (760, ('Std./Mst. Pkg.', 'Std/Mst Pkg', 'Std. / Mst. Pkg.')[section])):
                    y = top + (27 if section == 1 and x in (598, 684) else 38)
                    if section != 1:
                        label += ' M. R. P.' if x == 598 else ' M.R.P.' if x == 684 else ''
                    page.insert_text((x, y), label, fontsize=8)
                if section == 1:
                    page.insert_text((625, top + 38), 'M. R. P.', fontsize=8)
                    page.insert_text((695, top + 38), 'M.R.P.', fontsize=8)
                for offset in range(3):
                    index = section * 3 + offset
                    code = codes[index]
                    if code.isdigit() and index % 2 == 0:
                        code = code[:3] + ' ' + code[3:]
                    for x, value in ((389, code), (464, '10 AX 1 Way Switch'),
                                     (625, f'{113 + index}.00'), (692, f'{124 + index}.00'),
                                     (765, '10 / 1200')):
                        page.insert_text((x, top + 69 + offset * 20), value, fontsize=9)
            boxes = native_boxes(page)
            scan = page.get_pixmap(dpi=150).tobytes('png')
        # OCR can omit a gap within a label or merge neighboring headers.
        for x, bottom, text in ((680, 101, 'Grey/Black M.R.P.Std./Mst.Pkg.'),
                                (598, 245, 'NeoWhite')):
            parts = [box for box in boxes if abs(box.bottom - bottom) < 4 and box.x0 >= x
                     and (x != 598 or box.x1 < 680)]
            self.assertGreater(len(parts), 1)
            boxes = [box for box in boxes if box not in parts]
            boxes.append(TextBox(min(box.x0 for box in parts), min(box.top for box in parts),
                                 max(box.x1 for box in parts), max(box.bottom for box in parts), text))
        with pymupdf.open() as scanned:
            for _ in range(18):
                page = scanned.new_page(width=840, height=650)
            page.insert_image(page.rect, stream=scan)
            self.document.file.save('E-Square.pdf', ContentFile(scanned.tobytes()))

        with patch('catalogue.services.pdf_item_extractor.read_page', return_value=[]), patch(
            'catalogue.services.pdf_item_extractor.read_page_tesseract', return_value=(boxes, ''),
        ) as tesseract:
            response = self.client.post(self.base + 'extract/', {'start_page': 18, 'end_page': 18}, format='json')
        tesseract.assert_called_once()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['diagnostics']['pages'][0]['thumbnails'], len(codes), response.data['diagnostics'])
        drafts = {draft.product_code: draft for draft in self.document.draft_items.all()}
        self.assertEqual(set(drafts), set(codes))
        for index, code in enumerate(codes):
            draft = drafts[code]
            with self.subTest(code=code):
                self.assertEqual(draft.page, 18)
                self.assertIn('1 Way Switch', draft.name)
                self.assertEqual(draft.price_per_unit, 113 + index)
                self.assertEqual(draft.sub_category, titles[index // 3])
                self.assertEqual(draft.pack_size, {'standard': '10', 'box_quantity': '1200'})
                self.assertEqual(draft.specifications['MRP finish'], 'Neo White')
                self.assertEqual(draft.specifications['Grey/Black MRP'], f'{124 + index}.00')
                with draft.image.open() as image, Image.open(image) as photo:
                    pixel = photo.getpixel((photo.width // 2, photo.height // 2))
                    self.assertTrue(all(abs(actual - expected) <= 1 for actual, expected in zip(pixel, colors[index])), pixel)

        first = drafts['901101']
        response = self.client.post(self.base + 'drafts/commit/', {'rows': [{
            'id': first.pk, 'approved': True, 'name': first.name, 'product_code': '901  101',
            'price_per_unit': str(first.price_per_unit), 'category_id': self.association.category_id,
        }]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        item = Product.objects.get(code='901101')
        self.assertEqual(item.specifications['Grey/Black MRP'], '124.00')
        self.assertEqual(item.specifications['Pack size'], first.pack_size)
        self.assertEqual(item.specifications['Sub-category'], titles[0])

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

    def test_progressive_range_validates_full_bounds_and_defers_replacement(self):
        with pymupdf.open() as document, pymupdf.open(stream=self.content, filetype='pdf') as source:
            for _ in range(3):
                document.new_page()
            document.insert_pdf(source)
            self.document.file.save('chunks.pdf', ContentFile(document.tobytes()))
        draft = self.document.draft_items.create(page=1, product_code='EXISTING', name='Existing draft')
        url = self.base + 'extract/'
        first = {'start_page': 1, 'end_page': 3, 'range_end': 4, 'append': False}
        invalid = self.client.post(url, {**first, 'range_end': 9}, format='json')
        self.assertContains(invalid, "exceeds the PDF's 4 pages", status_code=400)
        blank = self.client.post(url, first, format='json')
        self.assertEqual(blank.status_code, 200, blank.data)
        self.assertEqual(blank.data['batch']['processed_through'], 3)
        self.assertFalse(blank.data['batch']['replaced'])
        self.assertEqual([row['id'] for row in blank.data['rows']], [draft.pk])
        priced = self.client.post(url, {'start_page': 4, 'end_page': 4, 'range_end': 4,
                                        'append': True, 'replace_on_items': True}, format='json')
        self.assertEqual(priced.status_code, 200, priced.data)
        self.assertTrue(priced.data['batch']['replaced'])
        self.assertEqual([row['product_code'] for row in priced.data['rows']], ['SW-001', 'SO-002'])

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
                         ('ZIVA 6A, 1 Way Switch', 'Modular Switchgear & Distribution', DraftCatalogueItem.Status.DRAFT))
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
                self.assertEqual(draft.category, 'Modular Switchgear & Distribution')

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
        protected = self.client.delete(self.base + 'delete/')
        self.assertContains(protected, 'linked to published catalogue items', status_code=409)
        self.assertTrue((self.root / draft.image.name).is_file())
        self.assertTrue((self.root / self.document.file.name).is_file())
        self.assertEqual(anon.get('/api/v1/catalogue/items/').data['count'], 1)
        self.assertEqual(self.client.post(self.base + 'drafts/commit/', payload, format='json').status_code, 409)


    def test_publish_331_rows_with_thumbnails_using_batched_queries(self):
        thumbnail = BytesIO()
        Image.new('RGB', (48, 48), 'green').save(thumbnail, format='PNG')
        draft_storage = DraftCatalogueItem._meta.get_field('image').storage
        path = draft_storage.save('test-fixtures/thumbnail.png', ContentFile(thumbnail.getvalue()))
        drafts = DraftCatalogueItem.objects.bulk_create([
            DraftCatalogueItem(source_document=self.document, page=index // 25 + 1, name=f'Switch {index}',
                               product_code=f'BATCH-{index:03}', image=path, pack_size={'standard': '10'})
            for index in range(332)
        ])
        rows = [
            {'id': draft.pk, 'approved': True, 'name': draft.name, 'product_code': draft.product_code,
             'hsn_sac_code': '8536', 'price_per_unit': '29.50', 'brand_category': self.association.pk}
            for draft in drafts[:-1]
        ] + [{'id': drafts[-1].pk, 'approved': False}]

        rows[165]['hsn_sac_code'] = 'ABC'
        invalid = self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json')
        self.assertContains(invalid, 'BATCH-165', status_code=400)
        self.assertContains(invalid, 'hsn_sac_code', status_code=400)
        self.assertEqual(Product.objects.count(), 0)
        self.assertEqual(self.document.draft_items.filter(status='DRAFT').count(), 332)
        rows[165]['hsn_sac_code'] = '8536'

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertLessEqual(len(queries), 20)
        self.assertEqual(len(response.data['items']), 331)
        self.assertEqual(response.data['discarded'], 1)
        self.assertEqual(Product.objects.filter(state='PUBLISHED').count(), 331)
        self.assertEqual(ProductMedia.objects.count(), 331)
        self.assertEqual(CatalogueAudit.objects.filter(action='PRODUCT_CREATED').count(), 331)
        self.assertEqual(self.document.draft_items.filter(status='APPROVED', product__isnull=False).count(), 331)
        self.assertEqual(Product.objects.get(code='BATCH-165').specifications, {'HSN': '8536', 'Pack size': {'standard': '10'}, 'Sub-category': 'SAMPLE'})
        self.assertEqual(self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json').status_code, 409)

    def test_publish_rolls_back_database_and_copied_photos_when_a_draft_image_is_missing(self):
        extracted = self.client.post(self.base + 'extract/').data['rows']
        drafts = list(self.document.draft_items.order_by('pk'))
        self.assertTrue(drafts[0].image and drafts[1].image)
        drafts[1].image.storage.delete(drafts[1].image.name)
        files_before = {path for path in self.root.rglob('*') if path.is_file()}
        rows = [
            {**{field: row[field] for field in ('id', 'name', 'product_code', 'hsn_sac_code', 'price_per_unit')},
             'brand_category': self.association.pk, 'approved': True}
            for row in extracted
        ]
        failed = self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json')
        self.assertContains(failed, 'The draft image is missing.', status_code=400)
        self.assertEqual(Product.objects.count(), 0)
        self.assertEqual(ProductMedia.objects.count(), 0)
        self.assertEqual(CatalogueAudit.objects.count(), 0)
        self.assertEqual(self.document.draft_items.filter(status='DRAFT').count(), 2)
        self.assertEqual({path for path in self.root.rglob('*') if path.is_file()}, files_before)


    def test_review_reports_publication_counts_and_all_conflicting_draft_ids(self):
        products = [
            Product.objects.create(brand_category=self.association, code=code, name=code, unit='each', state=state)
            for code, state in [('LIVE', 'PUBLISHED'), ('OTHER', 'PUBLISHED'), ('ARCHIVED', 'ARCHIVED')]
        ]
        DraftCatalogueItem.objects.create(
            source_document=self.document, page=1, name='Previously published', product_code='LIVE',
            status='APPROVED', product=products[0],
        )
        drafts = DraftCatalogueItem.objects.bulk_create([
            DraftCatalogueItem(source_document=self.document, page=2, name=code, product_code=code)
            for code in ['SAME', 'SAME', 'LIVE', 'ARCHIVED', 'FRESH']
        ])
        review = self.client.get(self.base + 'extract/')
        self.assertEqual(review.status_code, 200, review.data)
        self.assertEqual(review.data['summary'], {
            'pending': 5, 'published_from_document': 1, 'published_for_brand': 2,
        })
        self.assertEqual(review.data['existing_codes'], ['ARCHIVED', 'LIVE'])
        rows = [
            {'id': draft.pk, 'approved': True, 'name': draft.name, 'product_code': draft.product_code,
             'hsn_sac_code': '8536', 'price_per_unit': '10.00', 'brand_category': self.association.pk}
            for draft in drafts
        ]
        rejected = self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json')
        self.assertEqual(rejected.status_code, 400, rejected.data)
        errors = rejected.data['field_errors']['row_errors']
        self.assertEqual(set(errors), {str(draft.pk) for draft in drafts[:4]})
        for draft in drafts[:2]:
            self.assertIn('Duplicate code in batch', errors[str(draft.pk)]['product_code'])
        self.assertIn('Already in catalogue', errors[str(drafts[2].pk)]['product_code'])
        self.assertEqual(self.document.draft_items.filter(status='DRAFT').count(), 5)
        self.assertFalse(Product.objects.filter(code='FRESH').exists())

        for index in (1, 2, 3):
            rows[index] = {'id': drafts[index].pk, 'approved': False}
        published = self.client.post(self.base + 'drafts/commit/', {'rows': rows}, format='json')
        self.assertEqual(published.status_code, 201, published.data)
        self.assertEqual(len(published.data['items']), 2)
        self.assertEqual(self.client.get(self.base + 'extract/').data['summary'], {
            'pending': 0, 'published_from_document': 3, 'published_for_brand': 4,
        })


    def test_legacy_tagging_preview_apply_and_filter_composition(self):
        roma = Category.objects.create(name='ROMA')
        canonical = Category.objects.create(name='Modular Switchgear & Distribution')
        old = BrandCategory.objects.create(brand=self.association.brand, category=roma)
        product = Product.objects.create(
            brand_category=old, name='Roma socket', code='ROMA-1', unit='each',
            specifications={'HSN': '8536'}, state='PUBLISHED', catalogue_price=12, currency='INR',
        )
        orphan = Category.objects.create(name='Untagged')
        public = APIClient()
        options = public.get('/api/v1/catalogue/categories', {'scope': 'priced'}).data
        self.assertTrue(options['has_uncategorized'])
        self.assertNotIn(roma.pk, [row['id'] for row in options['results']])
        filters = {'category': ' Uncategorized ', 'brand': f' {old.brand_id} ', 'search': 'roma socket'}
        for route in ('products', 'items/'):
            self.assertEqual(public.get(f'/api/v1/catalogue/{route}', filters).data['count'], 1)
        out = StringIO()
        call_command('tag_untagged_catalogue_items', '--dry-run', stdout=out)
        self.assertIn('Would tag', out.getvalue())
        product.refresh_from_db()
        self.assertEqual(product.brand_category_id, old.pk)
        call_command('tag_untagged_catalogue_items', '--apply', stdout=StringIO())
        product.refresh_from_db()
        self.assertEqual(product.brand_category.category_id, canonical.pk)
        self.assertEqual(product.brand_category.brand_id, old.brand_id)
        self.assertFalse(Category.objects.filter(pk__in=[roma.pk, orphan.pk]).exists())
        self.assertFalse(public.get('/api/v1/catalogue/categories', {'scope': 'priced'}).data['has_uncategorized'])
        self.assertEqual(public.get('/api/v1/catalogue/items/', filters | {'category': str(canonical.pk)}).data['count'], 1)
        out = StringIO()
        call_command('tag_untagged_catalogue_items', '--apply', stdout=out)
        self.assertIn('0 tagged', out.getvalue())

    def test_staff_bulk_tag_keeps_brand_and_audits_moves(self):
        legacy = BrandCategory.objects.create(
            brand=self.association.brand, category=Category.objects.create(name='Uncategorized'),
        )
        products = [
            Product.objects.create(brand_category=legacy, name=f'Product {i}', code=f'TAG-{i}', unit='each')
            for i in range(2)
        ]
        endpoint = '/api/v1/staff/catalogue/products/bulk-tag'
        payload = {'products': [p.pk for p in products], 'brand_category': self.association.pk}
        self.assertEqual(APIClient().post(endpoint, payload, format='json').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/staff/catalogue/products', {'category': 'uncategorized'}).data['count'], 2)
        other = BrandCategory.objects.create(
            brand=Brand.objects.create(company=self.association.brand.company, name='Other brand'),
            category=self.association.category,
        )
        self.assertEqual(self.client.post(endpoint, payload | {'brand_category': other.pk}, format='json').status_code, 400)
        self.assertEqual(self.client.post(endpoint, payload, format='json').data, {'updated': 2})
        self.assertEqual(Product.objects.filter(pk__in=payload['products'], brand_category=self.association).count(), 2)
        self.assertEqual(CatalogueAudit.objects.filter(action='PRODUCT_CATEGORY_ASSIGNED').count(), 2)


    def test_extraction_hints_follow_document_sub_business_instead_of_series(self):
        self.document.sub_category = 'SWITCHES_SOCKETS'
        self.document.save(update_fields=['sub_category'])
        self.association.category.name = 'Other electrical products'
        self.association.category.save(update_fields=['name'])
        roma = Category.objects.create(name='ROMA')
        BrandCategory.objects.create(brand=self.association.brand, category=roma)
        canonical = Category.objects.create(name='Modular Switchgear & Distribution')
        BrandCategory.objects.create(brand=self.association.brand, category=canonical)
        response = self.client.post(self.base + 'extract/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['rows'])
        self.assertNotIn('ROMA', [entry['category__name'] for entry in response.data['categories']])
        self.assertTrue(all(row['category'] == canonical.name for row in response.data['rows']))


    def test_sub_category_counts_and_filter_are_scoped_to_priced_items(self):
        for code, label in [('S1', 'ROMA'), ('S2', ' Roma '), ('S3', 'Penta'), ('S4', '')]:
            Product.objects.create(code=code, name='Switch', unit='Unit', brand_category=self.association,
                                   catalogue_price=12, currency='INR', state='PUBLISHED',
                                   specifications={'Series': label})
        url = '/api/v1/catalogue/items/'
        params = {'brand': self.association.brand_id, 'category': self.association.category_id}
        response = self.client.get(url, {**params, 'facets': 'sub_categories', 'search': 'Switch'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {'count': 4, 'sub_categories': [
            {'id': 'penta', 'count': 1}, {'id': 'roma', 'count': 2},
        ]})
        response = self.client.get(url, {**params, 'sub_category': ' ROMA ', 'search': 'Switch'})
        self.assertEqual(response.data['count'], 2)
        self.assertEqual({row['sub_category'].lower() for row in response.data['results']}, {'roma'})


    def test_existing_import_uses_its_pdf_family_without_changing_top_level_category(self):
        self.document.filename = 'Roma_Urban.PDF'
        self.document.save(update_fields=['filename'])
        product = Product.objects.create(
            code='OLD', name='Switch', unit='Unit', brand_category=self.association,
            catalogue_price=12, currency='INR', state='PUBLISHED',
        )
        DraftCatalogueItem.objects.create(
            source_document=self.document, page=1, name='Switch', product_code='OLD',
            status='APPROVED', product=product,
        )
        response = self.client.get('/api/v1/catalogue/items/', {'sub_category': 'roma urban'})
        self.assertEqual(response.status_code, 200, response.data)
        row, = response.data['results']
        self.assertEqual(row['sub_category'], 'Roma Urban')
        self.assertEqual(row['category_name'], self.association.category.name)

    def test_matrix_and_wrapped_specs_keep_context_across_review_chunks(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream, pagesize=(595, 800))
        pdf.setFont('Helvetica', 9)
        pdf.drawString(35, 760, 'Series: ROMA URBAN')
        pdf.drawString(35, 743, 'HSN: 85365090')
        pdf.drawString(35, 726, 'Std. Pkg.: 12 Box Qty: 96')
        for x, label in ((225, '6A'), (410, '16A')):
            pdf.drawString(x, 706, label)
        headers = [(35, 'Description'), (205, 'SKU'), (292, 'MRP'), (389, 'SKU'), (478, 'LP')]
        for x, value in headers:
            pdf.drawString(x, 690, value)
        for y in (670, 625):
            for x, value in zip((35, 205, 292, 389, 478),
                                ('Bell push', '66605R', 'Rs. 1,23,456.50/-', '98123-BLK/2', 'MRP 2,450/-')):
                pdf.drawString(x, y, value)
            pdf.drawString(35, y - 12, '2M 250W DP ISI Matte Black')
        pdf.showPage()
        pdf.setFont('Helvetica', 9)
        for x, value in zip((35, 205, 292, 389, 478), ('Socket', 'SO-6A', '55', 'SO-16A', '85')):
            pdf.drawString(x, 730, value)
        pdf.drawString(35, 685, 'Section: PENTA')
        pdf.drawString(35, 667, 'HSN Code: 85366990')
        for x, value in headers:
            pdf.drawString(x, 650, value)
        for x, value in zip((35, 205, 292, 389, 478), ('Switch', 'PE-6A', '75', '', '')):
            pdf.drawString(x, 630, value)
        pdf.save()
        self.document.file.save('matrix.pdf', ContentFile(stream.getvalue()))
        first = self.client.post(self.base + 'extract/', {'start_page': 1, 'end_page': 1, 'range_end': 2}, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        rows = {row['product_code']: row for row in first.data['rows']}
        self.assertEqual(set(rows), {'66605R', '98123-BLK/2'})
        row = rows['66605R']
        self.assertEqual(row['price_per_unit'], '123456.5000')
        self.assertIn('Bell push 2M 250W DP ISI Matte Black', row['name'])
        self.assertEqual(row['specifications']['Variant'], '6A')
        self.assertEqual(row['specifications']['Wattage'], '250W')
        self.assertEqual(row['specifications']['Pole configuration'], 'DP')
        self.assertEqual(row['specifications']['Standard'], 'ISI')
        self.assertEqual(row['specifications']['Finish'], 'Matte Black')
        self.assertEqual(row['pack_size'], {'standard': '12', 'box_quantity': '96'})

        second = self.client.post(self.base + 'extract/', {
            'start_page': 2, 'end_page': 2, 'range_end': 2, 'append': True,
        }, format='json')
        self.assertEqual(second.status_code, 200, second.data)
        rows = {row['product_code']: row for row in second.data['rows']}
        inherited = rows['SO-16A']
        self.assertIn('16A', inherited['name'])
        self.assertEqual(inherited['sub_category'], 'ROMA URBAN')
        self.assertEqual(inherited['hsn_sac_code'], '85365090')
        self.assertEqual(inherited['pack_size'], row['pack_size'])
        self.assertEqual(rows['PE-6A']['hsn_sac_code'], '85366990')
        self.assertEqual(rows['PE-6A']['sub_category'], 'PENTA')
        self.assertEqual(rows['PE-6A']['pack_size'], {})
        self.assertEqual([page['page'] for page in second.data['diagnostics']['pages']], [1, 2])
        self.assertEqual(second.data['diagnostics']['pages'][0]['wrapped_items'], 2)

        approved = self.client.post(self.base + 'drafts/commit/', {'rows': [{
            'id': row['id'], 'approved': True, 'name': row['name'], 'product_code': row['product_code'],
            'hsn_sac_code': row['hsn_sac_code'], 'price_per_unit': row['price_per_unit'],
            'brand_category': self.association.pk, 'sub_category': 'Bell Push', 'pack_size': {'standard': '6'},
        }]}, format='json')
        self.assertEqual(approved.status_code, 201, approved.data)
        published = Product.objects.get(code='66605R')
        self.assertEqual(published.specifications['Sub-category'], 'Bell Push')
        self.assertEqual(published.specifications['Pack size'], {'standard': '6'})
        self.assertEqual(published.specifications['Wattage'], '250W')

    def test_native_image_spanning_a_block_is_shared_without_spilling_into_next_row(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream, pagesize=(595, 800))
        pdf.setFont('Helvetica', 9)
        pdf.drawImage(ImageReader(Image.new('RGB', (50, 60), 'red')), 25, 651, 48, 63)
        pdf.drawImage(ImageReader(Image.new('RGB', (7, 7), 'green')), 48, 598, 7, 7)
        for x, value in ((26, 'Photo'), (93, 'Description'), (266, 'SKU'), (395, 'MRP')):
            pdf.drawString(x, 730, value)
        for i, y in enumerate((704, 686, 668, 600)):
            for x, value in ((93, 'Switch'), (266, f'P-{i}'), (395, '30')):
                pdf.drawString(x, y, value)
        pdf.save()
        stats = {}
        rows = extract_items(stream.getvalue(), diagnostics=stats)
        self.assertEqual(len(rows), 4)
        self.assertTrue(rows[0].image)
        self.assertEqual([row.image for row in rows], [rows[0].image] * 3 + [None])
        self.assertEqual(stats['pages'][0]['thumbnails'], 3)

    def test_scanned_page_with_missing_tesseract_records_reason_and_keeps_batch_resumable(self):
        with pymupdf.open() as document:
            page = document.new_page()
            image = BytesIO()
            Image.new('RGB', (50, 50), 'red').save(image, format='PNG')
            page.insert_image((10, 10, 110, 110), stream=image.getvalue())
            content = document.tobytes()
        stats, progress = {}, {}
        with patch('catalogue.services.pdf_item_extractor.read_page', return_value=[]), patch(
            'catalogue.services.catalogue_ocr.shutil.which', return_value=None,
        ):
            self.assertEqual(extract_items(content, range_end=1, diagnostics=stats, progress=progress), [])
        self.assertEqual(progress['processed_through'], 1)
        self.assertEqual(stats['pages'][0]['reason'], 'ocr_no_readable_text')
        self.assertIn('Tesseract is unavailable', stats['pages'][0]['ocr_note'])


    def test_price_normalizes_inr_suffixes_without_accepting_ambiguous_amounts(self):
        from decimal import Decimal

        for raw in ('₹ 1,23,456.50/-', 'LP INR 123,456.50', 'MRP: Rs. 123456.50 / -'):
            with self.subTest(raw=raw):
                self.assertEqual(price(raw), Decimal('123456.50'))
        for raw in ('12,34', '₹ 25 to 50', 'Rs. -5.00', 'call for price'):
            self.assertIsNone(price(raw))


    def test_review_offers_unlinked_canonical_categories_and_publish_links_verified_brand(self):
        pipe = Category.objects.create(name='Conduits, Piping & Installation Accessories')
        Category.objects.create(name='Retired taxonomy', active=False)
        Category.objects.create(name='ROMA')
        self.document.business_type = 'PLUMBING'
        self.document.sub_category = 'PIPES_FITTINGS'
        self.document.save(update_fields=['business_type', 'sub_category'])
        draft = self.document.draft_items.create(page=1, name='Pipe', product_code='PIPE-41', category=pipe.name)
        result = self.client.get(self.base + 'extract/').data
        self.assertIn({'id': pipe.pk, 'name': pipe.name}, result['canonical_categories'])
        self.assertNotIn('ROMA', [row['name'] for row in result['canonical_categories']])
        self.assertNotIn('Retired taxonomy', [row['name'] for row in result['canonical_categories']])
        self.assertEqual(result['default_category'], pipe.name)
        self.assertFalse(BrandCategory.objects.filter(brand=self.association.brand, category=pipe).exists())
        response = self.client.post(self.base + 'drafts/commit/', {'rows': [{
            'id': draft.pk, 'approved': True, 'name': 'Pipe', 'product_code': 'PIPE-41',
            'hsn_sac_code': '', 'price_per_unit': '10', 'category_id': pipe.pk,
        }]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        product = Product.objects.get(code='PIPE-41')
        self.assertEqual(product.brand_category.brand_id, self.association.brand_id)
        self.assertEqual(product.brand_category.category_id, pipe.pk)
        self.assertEqual(product.specifications['HSN'], '')

    def test_review_and_publish_resolve_brand_prefixes_and_one_edit_typos(self):
        brand = Brand.objects.create(company=self.association.brand.company, name='Ashirvad Pipes')
        url = self.base + 'extract/'
        for index, label in enumerate(('ASHIRVAD', 'ASHIRVAD CPVC', 'ASHIRVAHD', 'ashirvad pipes', 'ASHIR')):
            with self.subTest(label=label):
                self.document.brand_name = label
                self.document.resolved_brand = None
                self.document.save(update_fields=['brand_name', 'resolved_brand'])
                review = self.client.get(url).data
                self.assertEqual(review['resolved_brand']['id'], brand.pk)
                self.assertIn(brand.pk, [option['id'] for option in review['available_brands']])
                draft = self.document.draft_items.create(page=1, name='Pipe', product_code=f'PIPE-{index}')
                response = self.client.post(self.base + 'drafts/commit/', {'rows': [{
                    'id': draft.pk, 'approved': True, 'name': draft.name, 'product_code': draft.product_code,
                    'price_per_unit': '10', 'category_id': self.association.category_id,
                }]}, format='json')
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(Product.objects.get(code=draft.product_code).brand_category.brand_id, brand.pk)

        Brand.objects.create(company=brand.company, name='Ashirvad Valves')
        self.document.brand_name = 'ASHIRVAD'
        self.document.resolved_brand = None
        self.document.save(update_fields=['brand_name', 'resolved_brand'])
        self.assertIsNone(self.client.get(url).data['resolved_brand'])
        self.document.brand_name = 'ASHIRVAD PIPES CPVC'
        self.document.save(update_fields=['brand_name'])
        self.assertEqual(self.client.get(url).data['resolved_brand']['id'], brand.pk)

    def test_explicit_brand_override_rechecks_eligibility_and_persists_ambiguous_identity(self):
        company = self.association.brand.company
        first = Brand.objects.create(company=company, name='Ashirvad Pipes')
        owner = make_account('+919800000084', 'COMPANY')
        other = CompanyProfile.objects.create(owner_account=owner, legal_name='Alternative',
            company_email='alternative@example.test', verification_state='VERIFIED')
        duplicate = Brand.objects.create(company=other, name=first.name)
        inactive_owner = make_account('+919800000085', 'COMPANY')
        inactive = CompanyProfile.objects.create(owner_account=inactive_owner, legal_name='Suspended',
            company_email='suspended@example.test', verification_state='VERIFIED')
        excluded = Brand.objects.create(company=inactive, name=first.name)
        inactive.activity_state = 'SUSPENDED'
        inactive.save(update_fields=['activity_state'])
        self.document.brand_name = 'ASHIRVAD'
        self.document.save(update_fields=['brand_name'])
        review = self.client.get(self.base + 'extract/').data
        self.assertFalse(review['brand_resolved'])
        self.assertNotIn(excluded.pk, [option['id'] for option in review['available_brands']])

        draft = self.document.draft_items.create(page=1, name='Pipe', product_code='OVERRIDE')
        rows = [{'id': draft.pk, 'approved': True, 'name': draft.name, 'product_code': draft.product_code,
                 'price_per_unit': '10', 'category_id': self.association.category_id}]
        endpoint = self.base + 'drafts/commit/'
        for selection in ({}, {'brand_id': excluded.pk}, {'brand_id': duplicate.pk, 'company_id': company.pk}):
            result = self.client.post(endpoint, {'rows': rows, **selection}, format='json')
            self.assertEqual(result.status_code, 400, result.data)
        self.document.refresh_from_db()
        self.assertIsNone(self.document.resolved_brand_id)
        self.assertFalse(Product.objects.filter(code='OVERRIDE').exists())

        # The selected identity must be retained even when two eligible brands have the same name.
        result = self.client.post(endpoint, {'rows': rows, 'brand_id': duplicate.pk}, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data['resolved_brand']['id'], duplicate.pk)
        self.document.refresh_from_db()
        self.assertEqual(self.document.brand_name, duplicate.name)
        self.assertEqual(self.document.resolved_brand_id, duplicate.pk)
        self.assertEqual(self.client.get(self.base + 'extract/').data['resolved_brand']['id'], duplicate.pk)
        self.assertEqual(Product.objects.get(code='OVERRIDE').brand_category.brand_id, duplicate.pk)

        # A company-only override can resolve a unique matching brand within that company.
        another = self.document.draft_items.create(page=1, name='Pipe adapter', product_code='COMPANY-OVERRIDE')
        result = self.client.post(endpoint, {'company_id': company.pk, 'rows': [{
            **rows[0], 'id': another.pk, 'name': another.name, 'product_code': another.product_code,
        }]}, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data['resolved_brand']['id'], first.pk)
        self.assertEqual(Product.objects.get(code=another.product_code).brand_category.brand_id, first.pk)

        # Editing the PDF's declared brand in the Vault clears the saved identity.
        result = self.client.patch(self.base, {'brand_name': 'Fixture'}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.document.refresh_from_db()
        self.assertEqual(self.document.resolved_brand_id, self.association.brand_id)
        self.assertEqual(self.client.get(self.base + 'extract/').data['resolved_brand']['id'], self.association.brand_id)

    def test_pdf_upload_edit_and_staff_endpoint_provision_catalogue_only_owners(self):
        upload = self.client.post('/api/v1/admin/catalogues/', {
            'title': 'Pipe catalogue', 'brand_name': 'ASHIRVAD', 'business_type': 'PLUMBING',
            'file': SimpleUploadedFile('pipes.pdf', self.content, content_type='application/pdf'),
        }, format='multipart')
        self.assertEqual(upload.status_code, 201, upload.data)
        document = CatalogueDocument.objects.get(key=upload.data['key'])
        brand = document.resolved_brand
        self.assertEqual(brand.name, 'ASHIRVAD')
        self.assertTrue(brand.company.can_publish_catalogue)
        self.assertFalse(brand.company.owner_account.has_usable_password())
        self.assertTrue(brand.company.owner_account.mobile_e164.startswith('catalogue-'))
        provision = '/api/v1/catalogue/brands/provision/'
        response = self.client.post(provision, {'brand_name': 'ASHIRVAHD', 'document_id': self.document.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['brand']['id'], brand.pk)
        self.document.refresh_from_db()
        self.assertEqual(self.document.resolved_brand_id, brand.pk)
        edited = self.client.patch(self.base, {'brand_name': 'NEW LIGHTS'}, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
        self.document.refresh_from_db()
        self.assertEqual(self.document.resolved_brand.name, 'NEW LIGHTS')

    def test_commit_provisions_brand_for_legacy_pdf(self):
        self.document.brand_name = 'Unlisted Pipeworks'
        self.document.save(update_fields=['brand_name'])
        draft = self.document.draft_items.create(page=1, name='Pipe', product_code='LEGACY-PIPE')
        response = self.client.post(self.base + 'drafts/commit/', {'rows': [{
            'id': draft.pk, 'approved': True, 'name': draft.name, 'product_code': draft.product_code,
            'price_per_unit': '10', 'category_id': self.association.category_id,
        }]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.document.refresh_from_db()
        self.assertEqual(self.document.resolved_brand.name, 'Unlisted Pipeworks')
        self.assertEqual(Product.objects.get(code=draft.product_code).brand_category.brand_id,
                         self.document.resolved_brand_id)

    def test_visual_brochure_keeps_product_columns_and_photos_separate(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream, pagesize=(600, 800))
        for row, y in enumerate((580, 340)):
            for column, (x, color) in enumerate(((55, 'red'), (345, 'blue'))):
                pdf.drawImage(ImageReader(Image.new('RGB', (40, 40), color)), x + 20, y + 45, 80, 80)
                pdf.drawString(x, y + 35, ('6A 1 Way Switch 1M', '16A Socket 2M')[column])
                pdf.drawString(x, y + 18, f'Cat. No. ES-{row}{column}')
                pdf.drawString(x, y, (f'Rs {125 + row}', f'{225 + row}/-')[column])
        pdf.save()
        stats = {}
        rows = extract_items(stream.getvalue(), family_hint='E SQUARE', diagnostics=stats)
        items = {row.product_code: row for row in rows}
        self.assertEqual(set(items), {'ES-00', 'ES-01', 'ES-10', 'ES-11'})
        for code, name, amount, color, module in (
            ('ES-00', '6A 1 Way Switch 1M', 125, (255, 0, 0), '1M'),
            ('ES-01', '16A Socket 2M', 225, (0, 0, 255), '2M'),
            ('ES-10', '6A 1 Way Switch 1M', 126, (255, 0, 0), '1M'),
            ('ES-11', '16A Socket 2M', 226, (0, 0, 255), '2M'),
        ):
            item = items[code]
            self.assertEqual(item.name, f'E SQUARE {name}')
            self.assertEqual(item.price_per_unit, amount)
            self.assertEqual(item.specifications['Module'], module)
            with Image.open(BytesIO(item.image)) as photo:
                self.assertEqual(photo.getpixel((photo.width // 2, photo.height // 2)), color)
        self.assertEqual(stats['pages'][0]['thumbnails'], 4)

    def test_switchgear_headers_and_cid_text_trigger_ocr(self):
        from catalogue.services.catalogue_layout import native_boxes

        with pymupdf.open() as document:
            page = document.new_page()
            for y, labels in (
                (65, ('Cat. No.', 'Description', 'Mod', 'List Price')),
                (95, ('ES-11', '6A 1 Way Switch', '1M', '125')),
                (125, ('ES-22', '16A Socket', '2M', '135')),
            ):
                for x, label in zip((40, 155, 365, 445), labels):
                    page.insert_text((x, y), label)
            boxes = native_boxes(page)
            native_pdf = document.tobytes()
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((45, 50), '(cid:150) (cid:154) (cid:160) (cid:165) (cid:170)')
            outlined_pdf = document.tobytes()
        stats = {}
        with patch('catalogue.services.pdf_item_extractor.read_page', return_value=boxes) as ocr:
            native = extract_items(native_pdf)
            ocr.assert_not_called()
            outlined = extract_items(outlined_pdf, diagnostics=stats)
            ocr.assert_called_once()
        for items in (native, outlined):
            self.assertEqual([(item.product_code, item.price_per_unit, item.specifications['Module']) for item in items],
                             [('ES-11', 125, '1M'), ('ES-22', 135, '2M')])
        self.assertEqual(stats['pages'][0]['native_chars'], 0)
        self.assertEqual(stats['pages'][0]['ocr'], 'rapidocr')

    def test_zero_items_diagnostic_reports_readable_characters_and_sample(self):
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((45, 50), 'Decorative electrical range and specifications')
            content = document.tobytes()
        stats = {}
        self.assertEqual(extract_items(content, diagnostics=stats), [])
        self.assertRegex(stats['pages'][0]['message'], r'^Page 1: \d+ readable characters, 0 price/code pairs matched\.')
        self.assertIn('Sample text: Decorative electrical range and specifications', stats['pages'][0]['message'])
        self.assertEqual(stats['items_extracted'], 0)
