from decimal import Decimal
from io import BytesIO
from subprocess import TimeoutExpired
from unittest.mock import patch

from django.test import SimpleTestCase
from PIL import Image
import pymupdf
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .services.catalogue_ocr import TESSERACT_RENDER_SIDE, OCRPageTimeout, TextBox, read_page, read_page_tesseract
from .services.pdf_item_extractor import extract_items


def write_row(pdf, x, y, offsets, values):
    for offset, value in zip(offsets, values):
        pdf.drawString(x + offset, y, value)


def parallel_price_list(columns, *, staggered=False):
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(990, 820))
    pdf.setFont('Helvetica', 9)
    for index in range(columns):
        x = 20 + index * 320
        y = 760 - (index * 65 if staggered else 0)
        pdf.drawString(x, y, ['CPVC Plumbing System', 'uPVC Aqualife', 'Silent SWR'][index])
        pdf.drawString(x, y - 20, f'Elbow {90 - 15 * index}° - HSN CODE: {39172390 + index}')
        positions = (0, 50, 110, 175, 220, 270)
        write_row(pdf, x, y - 42, positions, ('Size (cm)', 'Size (inch)', 'Part No.', 'Std. Pkg.', 'Box Qty.', 'MRP'))
        write_row(pdf, x, y - 61, positions, ('1.5', '1/2', str(70000537 + index), '10', '100', str(28 + index)))
        write_row(pdf, x, y - 80, positions, ('2.0', '3/4', str(70000637 + index), '8', '80', str(40 + index)))
    pdf.drawString(20, 32, 'WARRANTY APPLICABLE ONLY IF installed correctly')
    pdf.save()
    return stream.getvalue()


class LayoutExtractionTests(SimpleTestCase):
    def test_parallel_tables_keep_independent_sections_and_prices(self):
        for columns, staggered in ((2, False), (3, False), (3, True)):
            with self.subTest(columns=columns, staggered=staggered):
                stats = {}
                rows = extract_items(parallel_price_list(columns, staggered=staggered), diagnostics=stats)
                self.assertEqual(len(rows), 2 * columns)
                for index in range(columns):
                    row = rows[2 * index]
                    self.assertEqual(row.product_code, str(70000537 + index))
                    self.assertEqual(row.hsn_sac_code, str(39172390 + index))
                    self.assertEqual(row.price_per_unit, Decimal(28 + index))
                    self.assertEqual(row.name, f'Elbow {90 - 15 * index}° - 1.5 cm (1/2")')
                    self.assertEqual(row.pack_size, {'standard': '10', 'box_quantity': '100'})
                self.assertEqual([row.category for row in rows[::2]],
                                 ['CPVC Plumbing System', 'uPVC Aqualife', 'Silent SWR'][:columns])
                self.assertEqual(stats['product_sections'], columns)

    def test_pipe_lengths_and_non_dimensional_wrapped_variants(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream)
        pdf.setFont('Helvetica', 9)
        pdf.drawString(35, 765, 'CPVC Plumbing System')
        pdf.drawString(35, 745, 'SDR 11 Pipe - HSN CODE: 39172390')
        pipe = (0, 65, 140, 251, 335, 450)
        write_row(pdf, 35, 725, pipe, ('Size', 'Std Pkg', 'Part No. (3 mtr)', 'MRP (3 mtr)', 'Part No. (5/6 mtr)', 'MRP (5/6 mtr)'))
        write_row(pdf, 35, 704, pipe, ('20 mm', '10', 'PIPE-3', '340', 'PIPE-6', '620'))
        pdf.drawString(35, 675, 'Solvent Cement - HSN CODE: 35061000')
        chemical = (0, 195, 289, 360)
        write_row(pdf, 35, 655, chemical, ('Description', 'Part No.', 'Std. Pkg.', 'MRP'))
        write_row(pdf, 35, 635, chemical, ('15 ml Tube', 'SOL-15', '12', '58'))
        pdf.drawString(35, 605, 'Long Concealed Valve - HSN CODE: 84818020')
        valve = (0, 70, 140, 240, 320)
        write_row(pdf, 35, 585, valve, ('Size', 'Turn', 'Knob', 'Part No.', 'MRP'))
        write_row(pdf, 35, 565, valve, ('20 mm', 'Quarter', 'Chrome', 'VAL-20', '799'))
        pdf.drawString(175, 554, 'lever')
        pdf.save()
        rows = extract_items(stream.getvalue())
        self.assertEqual([(row.product_code, row.price_per_unit, row.hsn_sac_code) for row in rows],
                         [('PIPE-3', Decimal(340), '39172390'), ('PIPE-6', Decimal(620), '39172390'),
                          ('SOL-15', Decimal(58), '35061000'), ('VAL-20', Decimal(799), '84818020')])
        self.assertIn('3 mtr', rows[0].name)
        self.assertIn('5/6 mtr', rows[1].name)
        self.assertEqual(rows[2].name, 'Solvent Cement 15 ml Tube')
        self.assertIn('Chrome lever', rows[3].name)

    def test_skips_marketing_toc_unpriced_and_blank_pages(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream)
        for title in ('Premium Plumbing Solutions · Product Brochure', 'Table of Contents', 'Prices: Available on Request'):
            pdf.drawString(35, 750, title)
            pdf.drawString(35, 725, 'New / Introducing Shortly / Speciality')
            pdf.showPage()
        pdf.showPage()
        pdf.save()
        stats = {}
        self.assertEqual(extract_items(stream.getvalue(), diagnostics=stats), [])
        self.assertEqual(stats['pages_scanned'], 4)
        self.assertEqual([page['page'] for page in stats['skipped_pages']], [1, 2, 3, 4])
        self.assertIn('No priced SKU rows', stats['warnings'][0])

    def test_section_image_ignores_full_page_background_and_repeated_footer_logo(self):
        stream = BytesIO()
        pdf = canvas.Canvas(stream)
        logo = ImageReader(Image.new('RGB', (45, 45), 'green'))
        background = ImageReader(Image.new('RGB', (60, 80), 'black'))
        product = ImageReader(Image.new('RGB', (42, 42), 'red'))
        for index in range(2):
            pdf.drawImage(background, 0, 0, 500, 680)
            pdf.drawImage(logo, 30, 22, 28, 28)
            pdf.drawString(35, 755, 'Elbow - HSN CODE: 39172390')
            if index == 0:
                pdf.drawImage(product, 330, 655, 42, 42)
            write_row(pdf, 35, 640, (0, 90, 190), ('Size', 'Part No.', 'MRP'))
            write_row(pdf, 35, 621, (0, 90, 190), ('20 mm', f'ELB-{index}', '39'))
            pdf.showPage()
        pdf.save()
        first, second = extract_items(stream.getvalue())
        self.assertEqual(Image.open(BytesIO(first.image)).getpixel((0, 0)), (255, 0, 0))
        self.assertIsNone(second.image)

    def test_tesseract_tsv_coordinates_and_image_only_fallback(self):
        tsv = b'level\tleft\ttop\twidth\theight\ttext\n5\t10\t20\t40\t20\tPart\n'
        with pymupdf.open() as document:
            page = document.new_page()
            page.draw_rect((10, 10, 100, 100), fill=(0, 0, 0))
            content = document.tobytes()
            with patch('catalogue.services.catalogue_ocr.shutil.which', return_value='tesseract'), patch(
                    'catalogue.services.catalogue_ocr.subprocess.run') as engine:
                engine.return_value.stdout = tsv
                boxes, warning = read_page_tesseract(page, 10)
                self.assertEqual(warning, '')
                dpi = min(275, int(72 * (TESSERACT_RENDER_SIDE - 2) / max(page.rect.width, page.rect.height)))
                self.assertAlmostEqual(boxes[0].top, 20 * 72 / dpi)
                self.assertGreaterEqual(dpi, 250)
                self.assertLessEqual(max(Image.open(BytesIO(engine.call_args.kwargs['input'])).size), TESSERACT_RENDER_SIDE)
                self.assertEqual(engine.call_args.args[0][-3:], ['--psm', '6', 'tsv'])
        boxes = [TextBox(x, y, x + 30, y + 9, value) for x, y, value in (
            (20, 20, 'Elbow - HSN CODE: 39172390'), (20, 40, 'Size'),
            (110, 40, 'Part No.'), (210, 40, 'MRP'),
            (20, 60, '20 mm'), (110, 60, 'ELB-1'), (210, 60, '28'),
        )]
        stats = {}
        with patch('catalogue.services.pdf_item_extractor.read_page', return_value=[]), patch(
                'catalogue.services.pdf_item_extractor.read_page_tesseract', return_value=(boxes, '')):
            row, = extract_items(content, family_hint='Fixture', diagnostics=stats)
        self.assertEqual((row.name, row.product_code, row.price_per_unit),
                         ('Fixture Elbow - 20 mm', 'ELB-1', Decimal(28)))
        self.assertEqual(stats['ocr_pages'], 1)

    def test_electrical_columns_with_selectable_footer_and_outlined_rows(self):
        with pymupdf.open() as document:
            page = document.new_page(width=990, height=820)
            page.insert_text((20, 800), 'WARRANTY APPLICABLE ONLY IF installed correctly')
            for x in range(10, 100):
                page.draw_rect((x, 70, x + 1, 73), fill=(0, 0, 0), color=None)
            content = document.tobytes()
            with patch('catalogue.services.catalogue_ocr.subprocess.run', side_effect=TimeoutExpired('ocr', 2)) as process:
                with self.assertRaises(OCRPageTimeout):
                    read_page(page, timeout=2)
                self.assertEqual(process.call_args.kwargs['timeout'], 2)
        boxes = []
        for offset, sku, description in [(0, 'ES-501', 'Switch'), (480, 'ES-502', 'Socket')]:
            for x, label, value in zip((20, 90, 198, 240, 283, 327, 400),
                    ('Cat. No.', 'Description', 'Mod', 'Amp', 'Way', 'Std. Pkg.', 'Rate'),
                    (sku, description, '1M', '16A', '2', '10', '125.50')):
                boxes.extend([TextBox(x + offset, 70, x + offset + 32, 79, label),
                              TextBox(x + offset, 90, x + offset + 32, 99, value)])
        stats = {}
        with patch('catalogue.services.pdf_item_extractor.read_page', side_effect=OCRPageTimeout), patch(
                'catalogue.services.pdf_item_extractor.read_page_tesseract', return_value=(boxes, '')):
            rows = extract_items(content, diagnostics=stats)
        self.assertEqual([row.product_code for row in rows], ['ES-501', 'ES-502'])
        self.assertEqual([row.price_per_unit for row in rows], [Decimal('125.50')] * 2)
        self.assertEqual(rows[0].name, '16A Switch - 2 Way 1M')
        self.assertEqual(rows[1].pack_size, {'standard': '10'})
        self.assertEqual(stats['ocr_pages'], 1)
        self.assertIn('RapidOCR timed out', stats['warnings'][0])
