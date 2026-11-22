"""Extract review candidates from searchable, table-based catalogues."""

from contextlib import ExitStack
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
import re
import subprocess
from ..limits import CATALOGUE_PDF_LIMIT_MB, MAX_CATALOGUE_PDF_BYTES
from time import monotonic

import pymupdf as fitz
import pdfplumber
from pdfplumber.utils.exceptions import PdfminerException
from pdfminer.pdftypes import PDFException
from PIL import Image

from .catalogue_layout import DIMENSION, FACT_COLUMNS, NOISE, SKU, brochure_rows, code_value, layout_rows, native_boxes, skip_reason
from .catalogue_ocr import (
    MIN_NATIVE_TEXT, OCR_PAGE_SECONDS, RAPID_OCR_SECONDS, OCRPageTimeout, TextBox,
    native_text_quality, read_page, read_page_tesseract,
)
from .scanned_thumbnails import caption_key, crop_photo, crop_photos, left_gallery_photos, matching_caption


HEADERS = {
    'name': {'item', 'name', 'item name', 'product', 'product name', 'description', 'product description'},
    'product_code': {'code', 'item code', 'product code', 'sku', 'cat no', 'catalogue no', 'catalogue number', 'ref no', 'reference', 'model', 'model no', 'model number', 'part no', 'part number', 'ref number'},
    'hsn_sac_code': {'hsn', 'sac', 'hsn code', 'hsn sac', 'hsn sac code'},
    'price_per_unit': {'price', 'unit price', 'price per unit', 'list price', 'mrp', 'rate', 'mrp rs',
                       'list price rs', 'unit price rs', 'lp', 'lp rs', 'mrp unit', 'mrp per unit', 'unit sale price rs per number'},
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
MAX_ROWS = 500
EXTRACTION_BUDGET_SECONDS = 140
JOINED_OCR_WORDS = re.compile(r'(?<=[a-z])(?=[A-Z0-9])')


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
    pack_size: dict = field(default_factory=dict)
    sub_category: str = ''
    specifications: dict = field(default_factory=dict)
    matrix: bool = False
    wrapped: bool = False
    caption_matched: bool = False
    gallery_crop: bool = False


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
            vertical_distance = abs((top + bottom) - (y0 + y1)) / max(2, 2 * (bottom - top))
            horizontal_overlap = max(0, min(x1, right) - max(x0, left)) / max(1, x1 - x0)
            matches.append((overlap + .2 * horizontal_overlap - .3 * vertical_distance, image))
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
    cleaned = re.sub(r'^(?:(?:MRP(?:\s*/\s*unit)?|list\s+price|rate|price|LP)\b[\s.:]*|₹\s*|INR\s*|Rs\.?\s*)+', '', value.strip(), flags=re.I)
    cleaned = re.sub(r'\s*/\s*-\s*$', '', cleaned).strip()
    if not re.fullmatch(r'(?:\d+|\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?', cleaned):
        return None
    cleaned = cleaned.replace(',', '')
    if len(cleaned.split('.')[0]) > 14:
        return None
    return Decimal(cleaned)


def product_specifications(description, cells):
    facts = {label: cells[key] for key, label in FACT_COLUMNS.items() if cells.get(key)}
    for match in DIMENSION.finditer(description):
        value = match[0]
        unit = value.replace(' ', '').upper()
        if unit in {'SP', 'DP', 'TP', 'FP', 'SPN', 'TPN'}:
            facts.setdefault('Pole configuration', value)
        elif re.fullmatch(r'[\d.]+K?W', unit):
            facts.setdefault('Wattage', value)
        elif re.fullmatch(r'[\d.]+M', unit):
            facts.setdefault('Module', value)
        elif re.fullmatch(r'[\d.]+(?:AX?|MA)', unit):
            facts.setdefault('Rating', value)
    if match := re.search(r'\b(?:ISI|BIS|IS\s*[: ]\s*\d{3,6})\b', description, re.I):
        facts.setdefault('Standard', match[0])
    if match := re.search(r'\b(?:(?:glossy|matte)\s+)?(?:white|black|ivory|chrome|grey|gray|silver)\b', description, re.I):
        facts.setdefault('Finish', match[0])
    return facts


def layout_candidates(document, page, rows, boxes, images, page_number, family_hint, *, ocr=False):
    candidates = []
    photo_cache = {}
    column_crops = {}
    gallery_lefts = {row.bounds[0] for row in rows
                     if (ocr or row.finish_prices) and row.bounds[0] >= page.rect.width * .25}
    gallery_photos = {
        left: left_gallery_photos(page, boxes, [row.code for row in rows if row.bounds[0] == left], left)
        for left in gallery_lefts
    }

    def image_bytes(image):
        if image is None:
            return None
        key = tuple(image['bbox'])
        if key not in photo_cache:
            photo_cache[key] = thumbnail(document, page, image)
        return photo_cache[key]
    for row in rows:
        cells = row.cells
        description = cells.get('name', '')
        if ocr:
            description = JOINED_OCR_WORDS.sub(' ', description)
        if row.group and not family_prefix_pattern(row.group).match(description):
            description = ' '.join(filter(None, (row.group, description)))
        size = cells.get('size', '')
        if cm := cells.get('size_cm'):
            size = cm if cm.lower().endswith('cm') else f'{cm} cm'
        if inches := cells.get('size_inch'):
            inches = inches if inches.endswith(('"', '″')) or re.search(r'\bin(?:ch(?:es)?)?\b', inches, re.I) else f'{inches}"'
            size = f'{size} ({inches})' if size else inches
        way = cells.get('way', '')
        if way and way.isdecimal():
            way += ' Way'
        options = ' · '.join(filter(None, (size, row.length, cells.get('turn'), cells.get('knob'),
                                          way, cells.get('electrical_details'), cells.get('pole'),
                                          cells.get('wattage'), cells.get('finish'), cells.get('standard'))))
        if options:
            description = f'{description} - {options}'
        name, banner = row_name({**cells, 'name': description}, '', family_hint)
        if not name:
            continue
        left, top, right, bottom = row.bounds
        horizontal = row.image_bounds or (left, right)
        row_band = (horizontal[0], top - 5, horizontal[1], bottom + 5)
        column_images = [image for image in images if
                         horizontal[0] <= (image['bbox'][0] + image['bbox'][2]) / 2 <= horizontal[1]]
        photos, captions = gallery_photos.get(left, ({}, ()))
        photo = photos.get(row.code)
        if photo is None:
            photo = image_bytes(matching_image(row_band, column_images))
        if photo is None and row.image_bounds:
            center = (top + bottom) / 2
            spanning = [image for image in column_images if image['bbox'][1] <= center <= image['bbox'][3]]
            if len(spanning) == 1:
                photo = image_bytes(spanning[0])
            if photo is None:
                if horizontal not in column_crops:
                    aligned = [peer for peer in rows if peer.image_bounds == horizontal]
                    column_crops[horizontal] = crop_photos(page, (
                        horizontal[0], min(peer.bounds[1] for peer in aligned) - 20,
                        horizontal[1], max(peer.bounds[3] for peer in aligned) + 20,
                    ), boxes)
                crops = [data for y0, y1, _, data in column_crops[horizontal] if y0 <= center <= y1]
                if len(crops) == 1:
                    photo = crops[0]
        if photo is None and (row.group or row.series):
            # Group illustrations can sit above the variant rows. Only use a
            # single image that can be attributed to this section alone.
            peers = [peer for peer in rows if peer.bounds[0] == left]
            above = max((peer.bounds[3] for peer in peers if peer.section < row.section), default=0)
            group_rows = [peer for peer in peers if peer.section == row.section]
            first = min(peer.bounds[1] for peer in group_rows)
            last = max(peer.bounds[3] for peer in group_rows)
            section_images = [image for image in images if left <= image['bbox'][0] and image['bbox'][2] <= right
                              and max(above, first - 108) <= image['bbox'][1] and image['bbox'][3] <= last + 8]
            if len(section_images) == 1:
                photo = image_bytes(section_images[0])
        facts = {**product_specifications(name, cells), **row.finish_prices}
        if row.length:
            facts['Variant'] = row.length
        candidates.append(Candidate(page_number, name, row.code, row.hsn, row.amount,
                                    (row.category or banner)[:120], photo, row.pack,
                                    row.series, facts, row.matrix, row.wrapped,
                                    caption_matched=row.code in captions, gallery_crop=row.code in photos))
    return candidates


def brochure_candidates(document, page, boxes, images, page_number, family_hint):
    rows = brochure_rows(boxes, page.rect.width, price, [image['bbox'] for image in images])
    candidates = []
    for row in rows:
        name, category = row_name(row.cells, '', family_hint)
        if not name:
            continue
        photo = thumbnail(document, page, matching_image(row.bounds, images))
        if photo is None:
            photo = crop_photo(page, row.bounds, boxes)
        name = ' '.join(name.split())
        candidates.append(Candidate(page_number, name, row.code, '', row.amount, category, photo,
                                    specifications=product_specifications(name, row.cells)))
    return candidates


def product_images(page, repeated):
    images = []
    for image in page.get_image_info(xrefs=True):
        original = fitz.Rect(image['bbox'])
        box = original * page.rotation_matrix
        if (box.is_empty or box.width * box.height > page.rect.get_area() * .35 or
                box.width > page.rect.width * .8 or min(box.width, box.height) < 12):
            continue
        if (box.y1 <= page.rect.height * .065 or box.y0 >= page.rect.height * .935):
            continue
        if repeated[image.get('xref')] > 1 and (
                box.y0 < page.rect.height * .09 or box.y1 > page.rect.height * .91 or max(box.width, box.height) < 35):
            continue
        images.append({**image, 'bbox': tuple(box), 'unrotated_bbox': tuple(original)})
    return images


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
        # Mixed-case singular product names often introduce specifications, not headings.
        if match['category'].casefold() in {'switch', 'socket', 'bell push'} and match['category'] != match['category'].upper():
            break
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


def extract_items(content, *, family_hint='', start_page=1, end_page=None, progress=None, diagnostics=None, range_end=None, layout_context=None):
    stats = diagnostics if diagnostics is not None else {}
    stats.update(pages_scanned=0, ocr_pages=0, product_sections=0, items_extracted=0, caption_skus_found=0,
                 skipped_pages=[], warnings=[], pages=[], matrix_items=0, wrapped_items=0)
    if len(content) > MAX_CATALOGUE_PDF_BYTES:
        raise CataloguePDFError(f'The PDF exceeds the {CATALOGUE_PDF_LIMIT_MB} MB extraction limit.')
    try:
        result = _extract_items(content, family_hint, start_page, end_page, progress, stats, range_end, layout_context)
        if not result:
            stats['warnings'].append('No priced SKU rows were found. Check that the selected pages contain a readable price table.')
        elif missing_hsn := sum(not row.hsn_sac_code for row in result):
            stats['warnings'].append(f'{missing_hsn} extracted items have no HSN/SAC code. Add it during review if available.')
        return result
    except CataloguePDFError:
        raise
    except (PDFException, PdfminerException, ValueError, RuntimeError, OSError, SyntaxError) as error:
        raise CataloguePDFError('Could not read this PDF file. Please verify the file is a valid PDF.') from error


def extract_ocr_page(document, page, page_number, family_hint, images, deadline, stats, context):
    stats['ocr_pages'] += 1
    stats['pages'][-1]['ocr'] = 'rapidocr'
    page_deadline = min(deadline, monotonic() + OCR_PAGE_SECONDS)
    try:
        boxes = read_page(page, timeout=min(RAPID_OCR_SECONDS, page_deadline - monotonic()))
    except OCRPageTimeout:
        stats['warnings'].append(f'Page {page_number}: RapidOCR timed out. Trying the fallback engine.')
        boxes = []
    except (subprocess.SubprocessError, OSError, ValueError, ImportError, RuntimeError):
        stats['warnings'].append(f'Page {page_number}: RapidOCR could not read the page. Trying the fallback engine.')
        boxes = []
    has_text = bool(boxes)
    for fallback in (False, True):
        if fallback:
            stats['pages'][-1]['ocr'] = 'tesseract'
            boxes, warning = read_page_tesseract(page, page_deadline - monotonic())
            if warning:
                stats['pages'][-1]['ocr_note'] = warning
                stats['warnings'].append(f'Page {page_number}: {warning}')
            has_text |= bool(boxes)
        if boxes:
            stats['pages'][-1]['ocr_sample'] = [' '.join(box.text.split())[:96] for box in boxes[:4]]
        if reason := skip_reason(boxes):
            stats['skipped_pages'].append({'page': page_number, 'reason': reason})
            return [], has_text
        attempt_context = dict(context)
        rows, sections, advanced = layout_rows(boxes, page.rect.width, price, context=attempt_context, ocr=True)
        candidates = (layout_candidates(document, page, rows, boxes, images, page_number, family_hint, ocr=True)
                      if advanced or fallback else [])
        if not candidates and not fallback:
            candidates = ocr_rows(document, page, boxes, page_number, family_hint, images=images)
            if not candidates and rows:
                candidates = layout_candidates(document, page, rows, boxes, images, page_number, family_hint, ocr=True)
        if not candidates:
            candidates = brochure_candidates(document, page, boxes, images, page_number, family_hint)
        if candidates:
            context.update(attempt_context)
            stats['product_sections'] += sections or 1
            return candidates, has_text
    stats['skipped_pages'].append({'page': page_number, 'reason': 'no_priced_rows' if has_text else 'ocr_no_readable_text'})
    return [], has_text


def has_outlined_or_scanned_content(page):
    graphics = Counter(kind for kind, _ in page.get_bboxlog())
    return graphics['fill-image'] > 0 or graphics['fill-path'] + graphics['stroke-path'] >= 80


def finish_page(result, start, stats, context):
    page = stats['pages'][-1]
    unique = {}
    for item in result[start:]:
        key = (item.product_code, item.name, item.hsn_sac_code, item.price_per_unit, item.sub_category,
               tuple(sorted(item.pack_size.items())), tuple(sorted(item.specifications.items())))
        previous = unique.get(key)
        if previous is None or (not previous.image and item.image):
            unique[key] = item
    result[start:] = unique.values()
    if len(result) > MAX_ROWS:
        raise CataloguePDFError('The PDF exceeds the 500-row extraction limit.')
    if not unique:
        context.clear()
    page.update(items=len(unique), matrix_items=sum(item.matrix for item in unique.values()),
                wrapped_items=sum(item.wrapped for item in unique.values()),
                thumbnails=sum(bool(item.image) for item in unique.values()),
                caption_skus_found=len({item.product_code for item in unique.values() if item.caption_matched}),
                gallery_crops=sum(item.gallery_crop for item in unique.values()))
    stats['caption_skus_found'] += page['caption_skus_found']
    if stats['skipped_pages'] and stats['skipped_pages'][-1]['page'] == page['page']:
        page['reason'] = stats['skipped_pages'][-1]['reason']
    sample = page.pop('native_sample', [])
    ocr_sample = page.pop('ocr_sample', [])
    if not unique:
        reason = page.get('reason', '')
        if reason == 'table_of_contents':
            explanation = 'Skipped table of contents.'
        elif reason == 'prices_on_request':
            explanation = 'Skipped items marked price on request.'
        elif page['ocr']:
            explanation = 'OCR found no rows with a product description, code and price.'
        elif reason == 'blank':
            explanation = 'Page is blank.'
        else:
            explanation = f"{page['native_chars']} readable characters, 0 price/code pairs matched."
        excerpts = ocr_sample or sample
        page['message'] = f"Page {page['page']}: {explanation}"
        if excerpts:
            page['message'] += ' Sample text: ' + ' | '.join(excerpts)

    stats['matrix_items'] += page['matrix_items']
    stats['wrapped_items'] += page['wrapped_items']
    stats['items_extracted'] = len(result)
    stats['layout_context'] = {'page': page['page'], **context}


def _extract_items(content, family_hint, start_page, end_page, progress, stats, range_end, layout_context):
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
        requested_end = max(end_page, range_end or end_page)
        if requested_end > document.page_count:
            raise CataloguePDFError(f"Page range {start_page}-{requested_end} exceeds the PDF's {document.page_count} pages.")
        plumber = stack.enter_context(pdfplumber.open(
            BytesIO(content), password='', pages=list(range(start_page, end_page + 1)),
        ))
        result = []
        context = dict(layout_context or {}) if (layout_context or {}).get('page') == start_page - 1 else {}
        context.pop('page', None)
        has_text = False
        used_ocr = False
        repeated = Counter(xref for index in range(start_page - 1, end_page)
                           for xref in {image[0] for image in document[index].get_images()})
        for page in plumber.pages:
            index = page.page_number - 1
            if monotonic() >= deadline:
                if progress is None or index < start_page:
                    raise CataloguePDFError('Extraction took too long. Try a smaller page range.')
                progress.update(start_page=start_page, end_page=end_page, processed_through=index)
                return result
            raster_page = document[index]
            page_number = index + 1
            page_start = len(result)
            stats['pages'].append({'page': page_number, 'ocr': None})
            stats['pages_scanned'] += 1
            native_text = raster_page.get_text()
            readable, count, glyph_garbage = native_text_quality(native_text)
            has_text |= bool(count and not glyph_garbage)
            stats['pages'][-1].update(
                native_chars=count,
                native_sample=[' '.join(line.split())[:96] for line in readable.splitlines() if line.strip()][:4],
            )
            boxes = native_boxes(raster_page)
            if not glyph_garbage and (reason := skip_reason(boxes)):
                stats['skipped_pages'].append({'page': page_number, 'reason': reason})
                finish_page(result, page_start, stats, context)
                page.close()
                continue
            images = product_images(raster_page, repeated)
            if glyph_garbage or (count < MIN_NATIVE_TEXT and any(
                    kind in {'fill-image', 'fill-path', 'stroke-path', 'fill-shade'}
                    for kind, _ in raster_page.get_bboxlog())):
                used_ocr = True
                candidates, ocr_text = extract_ocr_page(document, raster_page, page_number, family_hint, images, deadline, stats, context)
                has_text |= ocr_text
                result.extend(candidates)
                stats['items_extracted'] = len(result)
                finish_page(result, page_start, stats, context)
                page.close()
                continue
            if not native_text.strip():
                stats['skipped_pages'].append({'page': page_number, 'reason': 'blank'})
                finish_page(result, page_start, stats, context)
                page.close()
                continue
            rows, sections, advanced = layout_rows(boxes, raster_page.rect.width, price, context=context)
            if rows and advanced:
                result.extend(layout_candidates(document, raster_page, rows, boxes, images, page_number, family_hint))
                stats['product_sections'] += sections
                stats['items_extracted'] = len(result)
                finish_page(result, page_start, stats, context)
                page.close()
                continue
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
                        if not NOISE.match(populated[0]):
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
                    code = code_value(cell('product_code'))
                    amount = price(cell('price_per_unit'))
                    if not name or not code or amount is None or NOISE.match(cell('name')):
                        continue
                    result.append(Candidate(index + 1, name, code[:100],
                        cell('hsn_sac_code')[:8], amount,
                        (cell('category') or detected_category or section)[:120],
                        thumbnail(document, raster_page,
                                  photos.get(code) or matching_image(row.bbox, images)),
                        sub_category=section or detected_category, specifications=product_specifications(name, name_cells)))
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
                stats['product_sections'] += len(result) > row_count
            if len(result) == page_start and rows:
                result.extend(layout_candidates(document, raster_page, rows, boxes, images, page_number, family_hint))
                stats['product_sections'] += sections
            if len(result) == page_start:
                cards = brochure_candidates(document, raster_page, boxes, images, page_number, family_hint)
                result.extend(cards)
                stats['product_sections'] += bool(cards)
            if len(result) == page_start and has_outlined_or_scanned_content(raster_page):
                used_ocr = True
                candidates, ocr_text = extract_ocr_page(document, raster_page, page_number, family_hint, images, deadline, stats, context)
                has_text |= ocr_text
                result.extend(candidates)
            elif len(result) == page_start:
                stats['skipped_pages'].append({'page': page_number, 'reason': 'no_priced_rows'})
            finish_page(result, page_start, stats, context)
            page.close()
        if progress is not None:
            progress.update(start_page=start_page, end_page=end_page, processed_through=end_page)
        if not result and not has_text and range_end is None:
            raise CataloguePDFError('This PDF contains no selectable or OCR-readable text.')
        if not result and used_ocr and range_end is None:
            raise CataloguePDFError('Text was found, but no product rows with a description, code and price could be extracted.')
        return result


def ocr_rows(document, page, boxes, page_number, family_hint, *, images=None):
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
    table_left = page.rect.width
    for index, line in enumerate(lines):
        line.sort(key=lambda box: box.x0)
        if NOISE.match(' '.join(box.text for box in line)):
            continue
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
            table_left = min(table_left, header[0][0] - 12)
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
        code = code_value(values.get('product_code', ''))
        values['product_code'] = code
        amount = price(values.get('price_per_unit', ''))
        top = min(box.top for box in line)
        bottom = max(box.bottom for box in line)
        if set(values) == {'name'} and pending and 0 <= top - pending[-1][3] <= 6:
            pending[-1][0]['name'] += ' ' + values['name']
            pending[-1][3] = bottom
            continue
        if not SKU.fullmatch(code) or amount is None or not values.get('name'):
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
    if images is None:
        images = product_images(page, Counter())
    result = []
    left_photos, left_captions = ({}, ())
    if table_left >= page.rect.width * .25:
        left_photos, left_captions = left_gallery_photos(
            page, boxes, [values['product_code'] for values, *_ in pending], table_left,
        )
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
        values['name'] = JOINED_OCR_WORDS.sub(' ', values['name'])
        name, category = row_name(values, '', family_hint)
        if not name:
            continue
        code = values['product_code']
        photo = left_photos.get(code)
        if photo is None:
            image = matching_image((table_left if left_captions else 0, top - 4, page.rect.width, bottom + 4), images)
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
                                amount, (values.get('category') or category or '')[:120], photo,
                                caption_matched=code in left_captions, gallery_crop=code in left_photos))
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
                                    amount, (detected_category or family)[:120], thumbnail(document, raster_page, image),
                                    sub_category=family, specifications=product_specifications(name, name_cells)))
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
