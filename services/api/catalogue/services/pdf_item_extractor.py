"""Extract review candidates from searchable, table-based catalogues."""

from contextlib import ExitStack
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re
from time import monotonic

import pymupdf as fitz
import pdfplumber
from pdfplumber.utils.exceptions import PdfminerException
from pdfminer.pdftypes import PDFException
from PIL import Image

from .catalogue_ocr import TextBox, read_page
from .scanned_thumbnails import caption_key, crop_photo, crop_photos, matching_caption


HEADERS = {
    'name': {'item', 'name', 'item name', 'product', 'product name', 'description', 'product description'},
    'product_code': {'code', 'item code', 'product code', 'sku', 'cat no', 'catalogue no', 'catalogue number', 'ref no', 'reference', 'model'},
    'hsn_sac_code': {'hsn', 'sac', 'hsn code', 'hsn sac', 'hsn sac code'},
    'price_per_unit': {'price', 'unit price', 'price per unit', 'list price', 'mrp', 'rate', 'mrp rs',
                       'list price rs', 'unit price rs', 'unit sale price rs per number'},
    'category': {'category', 'sub category', 'segment', 'sub business'},
    'rating': {'rating', 'ampere', 'amperes', 'amp rating', 'current rating'},
    'module': {'module', 'modules', 'module size', 'no of modules'},
}
NAME_FIELDS = ('rating', 'name', 'module')
GENERIC_CATEGORY_HEADERS = {
    'switch', 'switches', 'socket', 'sockets', 'switches and sockets',
    'modular switches', 'modular sockets', 'modular switches and sockets',
    'accessories', 'dimmer', 'dimmers', 'dimmers and regulators', 'regulator', 'regulators',
    'fan regulator', 'fan regulators', 'support module', 'support modules',
    'distribution board', 'distribution boards', 'power unit', 'power units',
    'communication socket', 'communication sockets', 'indicator', 'indicators',
    'bell push', 'bell pushes',
}
CATEGORY_PREFIX_REGEX = re.compile(
    r'^(?P<category>' + '|'.join(
        re.escape(heading).replace(r'\ and\ ', r'\s*(?:\band\b|&)\s*').replace(r'\ ', r'\s+')
        for heading in sorted(GENERIC_CATEGORY_HEADERS, key=lambda heading: (-len(heading), heading))
    ) + r')(?P<separator>[\s,:–—-]+|$)',
    re.IGNORECASE,
)
MAX_CATALOGUE_PDF_PAGES = 250
MAX_CATALOGUE_PDF_BYTES = 20 * 1024 * 1024
MAX_ROWS = 500
EXTRACTION_BUDGET_SECONDS = 150
MIN_NATIVE_TEXT = 20


class CataloguePDFError(ValueError):
    """A PDF extraction failure safe to display to staff."""


@dataclass
class Candidate:
    page: int
    name: str
    product_code: str
    hsn_sac_code: str
    price_per_unit: Decimal | None
    category: str
    image: bytes | None = None


def matching_image(row, images):
    """Require most of the image to lie inside the product's row band."""
    left, top, right, bottom = row
    matches = []
    for image in images:
        x0, y0, x1, y1 = image['bbox']
        if y1 <= y0 or x1 <= left or x0 >= right:
            continue
        overlap = max(0, min(y1, bottom) - max(y0, top)) / (y1 - y0)
        if overlap >= 0.65 and top <= (y0 + y1) / 2 <= bottom:
            matches.append((overlap, image))
    matches.sort(key=lambda match: match[0], reverse=True)
    if not matches or (len(matches) > 1 and matches[0][0] == matches[1][0]):
        return None
    return matches[0][1]


def labelled_images(page, table_bounds, images):
    """Index photos captioned by an exact item code outside the price table."""
    left, _, right, _ = table_bounds
    matches = {}
    ambiguous = set()
    for word in page.get_text('words'):
        box = fitz.Rect(word[:4]) * page.rotation_matrix
        if box.x0 < right and box.x1 > left:
            continue
        code = word[4]
        if not re.fullmatch(r'(?=.*[0-9])[A-Za-z0-9./_-]+', code):
            continue
        center = (box.x0 + box.x1) / 2
        candidates = []
        for image in images:
            x0, _, x1, y1 = image['bbox']
            if ((x1 <= left or x0 >= right) and x0 <= center <= x1
                    and 0 <= box.y0 - y1 <= 14):
                candidates.append((box.y0 - y1, image))
        candidates.sort(key=lambda candidate: candidate[0])
        if candidates and (len(candidates) == 1 or candidates[1][0] - candidates[0][0] > 1):
            image = candidates[0][1]
            if code in matches and matches[code] is not image:
                ambiguous.add(code)
            matches[code] = image
    return {code: image for code, image in matches.items() if code not in ambiguous}


def thumbnail(document, page, image):
    if not image or image['width'] * image['height'] > 16_777_216:
        return None
    try:
        if image.get('xref'):
            payload = document.extract_image(image['xref'])
        else:
            bounds = fitz.Rect(image.get('unrotated_bbox', image['bbox']))
            blocks = page.get_text('dict', clip=bounds + (-0.01, -0.01, 0.01, 0.01))['blocks']
            payload = next((block for block in blocks if block.get('type') == 1 and
                            all(abs(actual - expected) < 0.1 for actual, expected in zip(block['bbox'], bounds))), None)
        if not payload:
            return None
        with Image.open(BytesIO(payload['image'])) as decoded:
            decoded.thumbnail((320, 320))
            output = BytesIO()
            decoded.convert('RGB').save(output, 'PNG')
            return output.getvalue()
    except (OSError, ValueError, RuntimeError):
        return None


def price(value):
    cleaned = re.sub(r'^(?:₹|INR\s*|Rs\.?\s*)', '', value, flags=re.I).replace(',', '').strip()
    if not re.fullmatch(r'\d{1,14}(?:\.\d{1,4})?', cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def clean_extracted_name(value: str | None) -> str:
    name = ' '.join((value or '').split())
    # Some tracked PDFs interleave the module suffix with a two-digit AX rating.
    name = re.sub(r'\b(\d)\s+(\d)\s+(\d)\s+M\s+A\s*X\b', r'\2\3AX \1M', name, flags=re.I)
    name = re.sub(r'\b(\d+A\s*X?)(?=\d+\s+way\b)', r'\1 ', name, flags=re.I)
    name = re.sub(r'\b\d(?:\s*\d)*\s*(?:A\s*X|A|M)\b',
                  lambda match: re.sub(r'\s+', '', match[0]).upper(), name, flags=re.I)
    name = re.sub(r'\b(?:[A-Z]\s+){3,}[A-Z]\b',
                  lambda match: match[0].replace(' ', ''), name)
    name = re.sub(r'\s+,', ',', name)
    name = re.sub(r'\b(\d+)(?=way\b)', r'\1 ', name, flags=re.I)
    name = re.sub(r'\b(\d+)\s+modules?\b', r'\1M', name, flags=re.I)
    name = re.sub(r',\s*(?=[A-Za-z])', ', ', name)
    return re.sub(r'(?<=[A-Za-z]),\s*(?=\d+\s+[A-Za-z])', ', ', name)


def item_name(description, section):
    return normalize_item_name(description, section)[0]


def family_prefix_pattern(family):
    words = r'[\s_-]+'.join(re.escape(word) for word in family.split())
    return re.compile(r'^' + words + r'(?:[\s,:–—-]+|$)', flags=re.I)


def normalize_item_name(description, section, *, canonical_family=False):
    description, category = strip_leading_category_banner(description)
    family = section if canonical_family else clean_extracted_name(strip_leading_category_banner(section)[0])
    name = ' '.join(description.split())
    display_family = family
    pattern = family_prefix_pattern(family) if family else None
    while pattern and (prefix := pattern.match(name)):
        if not canonical_family:
            display_family = family if not name.lower().startswith(family.lower()) else name[:len(family)]
        name, embedded_category = strip_leading_category_banner(name[prefix.end():])
        category = category or embedded_category
    name = clean_extracted_name(name)
    if not name:
        return '', category
    if family:
        name = f'{display_family} {name}'
    return name[:200], category


def cell_text(page, bounds):
    if bounds is None:
        return ''
    clip = fitz.Rect(bounds) * page.derotation_matrix
    lines = {}
    for word in page.get_text('words', clip=clip):
        # Native line IDs keep overlapping text boxes from merging.
        lines.setdefault((word[5], word[6]), []).append(word)
    ordered_lines = sorted(lines.values(), key=lambda line: (
        min(word[1] for word in line), min(word[0] for word in line),
    ))
    return '\n'.join(' '.join(word[4] for word in sorted(line, key=lambda word: word[0]))
                     for line in ordered_lines)


def strip_leading_category_banner(description):
    description = (description or '').strip()
    category = ''
    while match := CATEGORY_PREFIX_REGEX.match(description):
        category = category or ' '.join(match['category'].upper().split())
        description = description[match.end():]
    return description, category


def row_name(values, section, family_hint):
    description, category = strip_leading_category_banner(values['name'])
    if not description:
        return '', category
    heading = re.sub(r'[^a-z0-9]+', ' ', section.lower().replace('&', ' and ')).strip()
    family = family_hint or (section if heading not in GENERIC_CATEGORY_HEADERS else '')
    if family and values.get('rating'):
        description, embedded_category = strip_leading_category_banner(
            family_prefix_pattern(family).sub('', description, count=1),
        )
        category = category or embedded_category
    parts = {**values, 'name': description}
    name, embedded_category = normalize_item_name(
        ' '.join(parts[field] for field in NAME_FIELDS if parts.get(field)), family,
        canonical_family=bool(family_hint),
    )
    return name, category or embedded_category


def extract_items(content, *, family_hint='', start_page=1, end_page=None, progress=None):
    if len(content) > MAX_CATALOGUE_PDF_BYTES:
        raise CataloguePDFError('The PDF exceeds the 20 MB extraction limit.')
    try:
        return _extract_items(content, family_hint, start_page, end_page, progress)
    except CataloguePDFError:
        raise
    except (PDFException, PdfminerException, ValueError, RuntimeError, OSError, SyntaxError) as error:
        raise CataloguePDFError('Could not read this PDF file. Please verify the file is a valid PDF.') from error


def _extract_items(content, family_hint, start_page, end_page, progress):
    deadline = monotonic() + EXTRACTION_BUDGET_SECONDS
    with ExitStack() as stack:
        document = stack.enter_context(fitz.open(stream=content, filetype='pdf'))
        # needs_pass describes the original document and may stay true after authentication.
        if document.needs_pass and not document.authenticate(''):
            raise CataloguePDFError('This PDF is password-protected. Upload an unlocked PDF.')
        if not document.page_count:
            raise CataloguePDFError('Could not read this PDF file. Please verify the file is a valid PDF.')
        if document.page_count > MAX_CATALOGUE_PDF_PAGES:
            raise CataloguePDFError(
                f'This PDF has {document.page_count} pages, which exceeds the {MAX_CATALOGUE_PDF_PAGES}-page limit.',
            )
        end_page = document.page_count if end_page is None else end_page
        if start_page < 1 or end_page < start_page:
            raise CataloguePDFError('The end page must be at or after the start page.')
        if end_page > document.page_count:
            raise CataloguePDFError(f"Page range {start_page}-{end_page} exceeds the PDF's {document.page_count} pages.")
        plumber = stack.enter_context(pdfplumber.open(
            BytesIO(content), password='', pages=list(range(start_page, end_page + 1)),
        ))
        result = []
        has_text = False
        used_ocr = False
        for page in plumber.pages:
            index = page.page_number - 1
            if monotonic() >= deadline:
                if progress is None or index < start_page:
                    raise CataloguePDFError('Extraction took too long. Try a smaller page range.')
                progress.update(start_page=start_page, end_page=end_page, processed_through=index)
                return result
            raster_page = document[index]
            native_text = raster_page.get_text()
            has_text |= any(character.isalnum() for character in native_text)
            if sum(character.isalnum() for character in native_text) < MIN_NATIVE_TEXT and raster_page.get_contents():
                used_ocr = True
                try:
                    boxes = read_page(raster_page)
                except ImportError as error:
                    raise CataloguePDFError('Catalogue OCR is unavailable. Install the API OCR dependencies and try again.') from error
                has_text |= any(any(character.isalnum() for character in box.text) for box in boxes)
                result.extend(ocr_rows(document, raster_page, boxes, index + 1, family_hint))
                if len(result) > MAX_ROWS:
                    raise CataloguePDFError('The PDF exceeds the 500-row extraction limit.')
                page.close()
                continue
            if not native_text.strip():
                page.close()
                continue
            images = raster_page.get_image_info(xrefs=True)
            # PyMuPDF image boxes are unrotated. pdfplumber rows use displayed coordinates.
            if raster_page.rotation:
                images = [{**image, 'unrotated_bbox': image['bbox'],
                           'bbox': tuple(fitz.Rect(image['bbox']) * raster_page.rotation_matrix)} for image in images]
            tables = page.find_tables()
            for table in tables:
                photos = labelled_images(raster_page, table.bbox, images)
                columns = {}
                section = ''
                header_row = None
                row_count = len(result)
                for row, values in zip(table.rows, table.extract()):
                    cells = [' '.join((value or '').split()) for value in values]
                    keys = [re.sub(r'[^a-z0-9]+', ' ', cell.lower()).strip() for cell in cells]
                    header = {field: offset for offset, cell in enumerate(cells)
                              for field, aliases in HEADERS.items()
                              if keys[offset] in aliases}
                    if 'product_code' not in header and 'item' in keys and header.get('name') != keys.index('item'):
                        header['product_code'] = keys.index('item')
                    if {'name', 'product_code', 'price_per_unit'} <= header.keys():
                        columns = header
                        header_row = row
                        continue
                    if not columns:
                        continue
                    populated = [cell for cell in cells if cell]
                    if len(populated) == 1:
                        section = populated[0]
                        continue

                    def cell(field):
                        offset = columns.get(field)
                        return cells[offset] if offset is not None and offset < len(cells) else ''

                    name_cells = {field: cell_text(raster_page, row.cells[columns[field]])
                                  for field in NAME_FIELDS if field in columns and columns[field] < len(row.cells)}
                    if 'name' not in name_cells:
                        continue
                    name, detected_category = row_name(name_cells, section, family_hint)
                    if not name or not cell('product_code'):
                        continue
                    if len(result) >= MAX_ROWS:
                        raise CataloguePDFError('The PDF exceeds the 500-row extraction limit.')
                    result.append(Candidate(index + 1, name, cell('product_code')[:100],
                        cell('hsn_sac_code')[:8], price(cell('price_per_unit')),
                        (cell('category') or detected_category or section)[:120],
                        thumbnail(document, raster_page,
                                  matching_image(row.bbox, images) or photos.get(cell('product_code')))))
                if header_row is not None and row_count == len(result):
                    # Some price lists draw borders only around column headers.
                    # Infer body rows from code, HSN and price on the same baseline.
                    left, _, right, bottom = table.bbox
                    limit = min((other.bbox[1] for other in tables if other.bbox[1] >= bottom
                                 and abs(other.bbox[0] - left) < 3 and abs(other.bbox[2] - right) < 3),
                                default=page.bbox[3])
                    # Ignore single-column boxes such as separately bordered MRP cells.
                    if 'hsn_sac_code' in columns:
                        result.extend(aligned_rows(page, header_row, columns, bottom, limit, section, family_hint,
                                                   index + 1, document, raster_page, images, photos))
                    if len(result) > MAX_ROWS:
                        raise CataloguePDFError('The PDF exceeds the 500-row extraction limit.')
            page.close()
        if progress is not None:
            progress.update(start_page=start_page, end_page=end_page, processed_through=end_page)
        if not result and not has_text:
            raise CataloguePDFError('This PDF contains no selectable or OCR-readable text.')
        if not result and used_ocr:
            raise CataloguePDFError('Text was found, but no product rows with a description, code and price could be extracted.')
        return result


def ocr_rows(document, page, boxes, page_number, family_hint):
    """Map OCR boxes to header columns and read cells on the same baseline."""
    lines = []
    for box in sorted(boxes, key=lambda box: (box.center, box.x0)):
        if not box.text:
            continue
        if not lines or box.center - lines[-1][0].center > max(3, (box.bottom - box.top) * 0.45):
            lines.append([])
        lines[-1].append(box)

    aliases = {alias.replace(' ', ''): field for field, values in HEADERS.items() for alias in values}
    aliases.update(dict.fromkeys(('image', 'photo', 'picture'), 'image'))
    ignored = {'std', 'mater', 'master', 'pack', 'packing', 'unit', 'qty'}
    columns = []
    pending = []
    table_right = 0
    for index, line in enumerate(lines):
        line.sort(key=lambda box: box.x0)
        header = []
        for box in line:
            key = re.sub(r'[^a-z0-9]+', '', box.text.lower())
            field = aliases.get(key)
            if key == 'product' and index + 1 < len(lines):
                # Some price lists print PRODUCT above CODE in a single header cell.
                if any(next_box.text.casefold() == 'code' and abs(next_box.x0 - box.x0) <= 12
                       and next_box.center - box.center <= 16 for next_box in lines[index + 1]):
                    field = 'product_code'
            if field or key in ignored:
                header.append((box.x0, field))
        fields = {field for _, field in header}
        if {'name', 'product_code', 'price_per_unit'} <= fields:
            table_right = max(table_right, header[-1][0] + 32)
            columns = [(left - 12 if offset == 0 else (header[offset - 1][0] + left) / 2, field)
                       for offset, (left, field) in enumerate(header)]
            continue
        if not columns:
            continue

        cells = {}
        for box in line:
            # Header labels can be centered while body cells are left-aligned.
            field = next((field for left, field in reversed(columns) if box.x0 >= left), None)
            if field:
                cells.setdefault(field, []).append(box.text)
        values = {field: ' '.join(words) for field, words in cells.items()}
        code = values.get('product_code', '')
        amount = price(values.get('price_per_unit', ''))
        top = min(box.top for box in line)
        bottom = max(box.bottom for box in line)
        if set(values) == {'name'} and pending and 0 <= top - pending[-1][3] <= 6:
            pending[-1][0]['name'] += ' ' + values['name']
            pending[-1][3] = bottom
            continue
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9./_-]*', code) or amount is None or not values.get('name'):
            continue
        if any(field == 'hsn_sac_code' for _, field in columns) and not re.fullmatch(r'\d{4,8}', values.get('hsn_sac_code', '')):
            continue
        image_bounds = next(((left, right) for (left, field), (right, _) in zip(columns, columns[1:])
                             if field == 'image'), None)
        if image_bounds and columns[0][1] == 'image':
            image_bounds = (image_bounds[0], min(box.x0 for box in line if box.x0 >= image_bounds[1]) - 4)
        pending.append([values, amount, top, bottom, image_bounds])

    if not pending:
        return []
    images = page.get_image_info(xrefs=True)
    if page.rotation:
        images = [{**image, 'unrotated_bbox': image['bbox'],
                   'bbox': tuple(fitz.Rect(image['bbox']) * page.rotation_matrix)} for image in images]
    result = []
    captions = {}
    known_codes = {caption_key(values['product_code']) for values, *_ in pending}
    side_boxes = [box for box in boxes if box.x0 >= table_right]
    for box in side_boxes:
        key = caption_key(box.text)
        if '/' not in box.text and key not in known_codes:
            splits = [offset for offset in range(4, len(key) - 3)
                      if key[:offset] in known_codes and key[offset:] in known_codes]
            if len(splits) == 1:
                offset = splits[0]
                middle = box.x0 + (box.x1 - box.x0) * offset / len(key)
                for code, left, right in ((key[:offset], box.x0, middle), (key[offset:], middle, box.x1)):
                    captions.setdefault(code, set()).add(TextBox(left, box.top, right, box.bottom, code))
                continue
        for code in box.text.split('/'):
            captions.setdefault(caption_key(code), set()).add(box)
        # Join a short suffix on the next line only when it sits under this code.
        for suffix in side_boxes:
            if (re.fullmatch(r'-?\d{1,3}|-?[A-Z]{1,2}', suffix.text)
                    and 0 <= suffix.top - box.bottom <= 5
                    and abs((box.x0 + box.x1) - (suffix.x0 + suffix.x1)) <= 12):
                captions.setdefault(caption_key(box.text + suffix.text), set()).add(box)
    column_photos = {}
    for left, right in {item[-1] for item in pending if item[-1]}:
        bands = [(top, bottom) for _, _, top, bottom, bounds in pending if bounds == (left, right)]
        bounds = (left, bands[0][0] - 22, right, bands[-1][1] + 22)
        column_photos[(left, right)] = crop_photos(page, bounds, boxes)
    for index, (values, amount, top, bottom, image_bounds) in enumerate(pending):
        values['name'] = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', values['name'])
        name, category = row_name(values, '', family_hint)
        if not name:
            continue
        image = matching_image((0, top - 4, page.rect.width, bottom + 4), images)
        photo = thumbnail(document, page, image)
        if photo is None and image_bounds:
            center = (top + bottom) / 2
            spanning = [data for y0, y1, _, data in column_photos[image_bounds] if y0 <= center <= y1]
            if len(spanning) == 1:
                photo = spanning[0]
        if photo is None and image_bounds:
            left, right = image_bounds
            before = pending[index - 1][3] if index else top - 44
            after = pending[index + 1][2] if index + 1 < len(pending) else bottom + 44
            bounds = (left, max(top - 22, (before + top) / 2),
                      right, min(bottom + 22, (after + bottom) / 2))
            photo = crop_photo(page, bounds, boxes)
        if photo is None:
            caption = matching_caption(values['product_code'], captions)
            if caption:
                center = (caption.x0 + caption.x1) / 2
                half_width = max(19, (caption.x1 - caption.x0) / 2 + 3)
                photo = crop_photo(page, (max(table_right, center - half_width), caption.top - 54,
                                         center + half_width, caption.top - 1), boxes)
        result.append(Candidate(page_number, name, values['product_code'][:100], values.get('hsn_sac_code', '')[:8],
                                amount, (values.get('category') or category or '')[:120], photo))
    return result


def aligned_rows(page, header, columns, start, end, section, family_hint, page_number, document, raster_page, images, photos):
    bounds = {field: header.cells[offset] for field, offset in columns.items()}
    if any(bounds[field] is None for field in ('product_code', 'name', 'hsn_sac_code', 'price_per_unit')):
        return []

    def column(field):
        left, _, right, _ = bounds[field]
        return page.within_bbox((left, start, right, end)).extract_words()

    hsns = column('hsn_sac_code')
    prices = column('price_per_unit')
    anchors = []
    for code in column('product_code'):
        if not re.fullmatch(r'(?=.*[0-9])[A-Za-z0-9./_-]+', code['text']):
            continue
        hsns_here = [word['text'] for word in hsns if abs(word['top'] - code['top']) < 3
                     and re.fullmatch(r'\d{4,8}', word['text'])]
        amounts = [amount for word in prices if abs(word['top'] - code['top']) < 3
                   if (amount := price(word['text'])) is not None]
        if len(hsns_here) == len(amounts) == 1:
            anchors.append((code, hsns_here[0], amounts[0]))
    anchors.sort(key=lambda row: row[0]['top'])
    words = page.within_bbox((header.bbox[0], start, header.bbox[2], end)).extract_words()
    banners = section_banners(page, words, header.bbox, anchors)
    output = []
    for index, (code, hsn, amount) in enumerate(anchors):
        center = (code['top'] + code['bottom']) / 2
        before = anchors[index - 1][0] if index else None
        after = anchors[index + 1][0] if index + 1 < len(anchors) else None
        top = max(start, (center + (before['top'] + before['bottom']) / 2) / 2) if before else max(start, center - 10)
        bottom = min(end, (center + (after['top'] + after['bottom']) / 2) / 2) if after else min(end, center + 10)
        previous_banner = next((banner for banner in reversed(banners) if banner[1] <= center), None)
        next_banner = next((banner for banner in banners if banner[0] > center), None)
        family = previous_banner[2] if previous_banner else section
        if previous_banner:
            top = max(top, previous_banner[1])
        if next_banner:
            bottom = min(bottom, next_banner[0])
        name_cells = {field: cell_text(raster_page, (bounds[field][0], top, bounds[field][2], bottom))
                      for field in NAME_FIELDS if bounds.get(field) is not None}
        name, detected_category = row_name(name_cells, family, family_hint)
        if name:
            image = matching_image((header.bbox[0], top, header.bbox[2], bottom), images) or photos.get(code['text'])
            output.append(Candidate(page_number, name, code['text'][:100], hsn,
                                    amount, (detected_category or family)[:120], thumbnail(document, raster_page, image)))
    return output


def section_banners(page, words, header_bounds, anchors):
    left, _, right, _ = header_bounds
    width = right - left
    banners = {}
    for rect in page.rects:
        top, bottom = rect['top'], rect['bottom']
        overlap = min(rect['x1'], right) - max(rect['x0'], left)
        if not rect['fill'] or overlap < width * 0.8 or not 5 <= bottom - top <= 32:
            continue
        if any(top <= code['top'] < bottom for code, _, _ in anchors):
            continue
        inside = [word for word in words if top <= word['top'] < bottom and
                  left <= (word['x0'] + word['x1']) / 2 < right]
        text = ' '.join(word['text'] for word in sorted(inside, key=lambda word: word['x0']))
        if text.isupper() and len(text) <= 120:
            banners[(top, bottom)] = text
    return [(top, bottom, text) for (top, bottom), text in sorted(banners.items())]
