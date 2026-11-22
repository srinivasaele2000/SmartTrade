"""Read bounded catalogue PDF metadata without importing the document."""
from pathlib import PurePath
import re
from subprocess import SubprocessError
from time import monotonic

import pymupdf
from rest_framework import serializers

from .brands import brand_matches, eligible_brands
from .limits import MAX_CATALOGUE_PDF_BYTES
from .services.catalogue_ocr import OCRPageTimeout, native_text_quality, read_page, read_page_tesseract
from .taxonomy import SUB_CATEGORIES


def open_pdf(file):
    try:
        content = file.read(MAX_CATALOGUE_PDF_BYTES + 1)
        if len(content) > MAX_CATALOGUE_PDF_BYTES:
            raise serializers.ValidationError({'file': 'This PDF exceeds the catalogue upload limit.'})
        pdf = pymupdf.open(stream=content, filetype='pdf')
    except (ValueError, RuntimeError) as exc:
        raise serializers.ValidationError({'file': 'Could not read this PDF.'}) from exc
    if pdf.needs_pass and not pdf.authenticate(''):
        pdf.close()
        raise serializers.ValidationError({'file': 'Unlock the PDF before inspection.'})
    return pdf


def stored_page_count(item):
    if item.content_type != 'application/pdf' or item.page_count is not None or not item.file:
        return item.page_count
    try:
        with item.file.open('rb') as file, open_pdf(file) as pdf:
            item.page_count = pdf.page_count or None
    except (OSError, serializers.ValidationError):
        return None
    if item.page_count:
        type(item).objects.filter(pk=item.pk, page_count__isnull=True).update(page_count=item.page_count)
    return item.page_count


RULES = (
    ('PLUMBING', 'PIPES_FITTINGS', r'\b(?:cpvc|upvc|pipe fittings|plumbing)\b'),
    ('ELECTRICAL', 'SWITCHES_SOCKETS', r'\b(?:e[ -]square|e[ -]soft|e[ -]flat|switches|sockets|switchgear)\b'),
    ('NETWORKING', 'LAN_ETHERNET_CABLES', r'\b(?:ethernet|lan cables?)\b'),
    ('ELECTRICAL', 'WIRES_CABLES', r'\b(?:wires?|cables?)\b'),
    ('ELECTRICAL', 'MCB_DISTRIBUTION', r'\b(?:mcbs?|rccbs?|distribution boards?)\b'),
    ('ELECTRICAL', 'LIGHTING', r'\b(?:led|lighting|luminaires?)\b'),
    ('PLUMBING', 'SANITARYWARE', r'\bsanitary\s?ware\b'),
    ('PLUMBING', 'FAUCETS_SHOWERS', r'\b(?:faucets?|showers?)\b'),
    ('PAINTS', 'INTERIOR_EMULSION', r'\bemulsion\b'),
)
SERIES = re.compile(r'\b(?:E[ -]Square|E[ -]Soft|E[ -]Flat|CPVC|UPVC|Wires\s*(?:&|and)\s*Cables)\b', re.I)


def inspect_pdf(file):
    filename = PurePath(file.name).stem.replace('_', ' ')
    with open_pdf(file) as pdf:
        metadata = pdf.metadata or {}
        cover = []
        deadline = monotonic() + 14
        for index in range(min(pdf.page_count, 3)):
            page = pdf[index]
            readable, count, garbage = native_text_quality(page.get_text()[:12000])
            if (count < 30 or garbage) and monotonic() < deadline:
                try:
                    boxes, _ = read_page_tesseract(page, min(6, deadline - monotonic()))
                    if not boxes and monotonic() < deadline:
                        boxes = read_page(page, timeout=min(5, deadline - monotonic()))
                except (OCRPageTimeout, OSError, RuntimeError, ValueError, SubprocessError):
                    boxes = []
                if boxes:
                    readable = ' '.join(box.text for box in boxes)
            cover.append(readable[:6000])
        page_count = pdf.page_count
    title = (metadata.get('title') or '').strip()
    sources = [title, filename, *cover]
    options = list(eligible_brands())
    brand = ''
    for source in [metadata.get('author') or '', *sources]:
        matches = [option for option in options if re.search(
            r'(?<!\w)' + re.escape(option.name) + r'(?!\w)', source, re.I)]
        if not matches and source in (title, filename):
            matches = brand_matches(source, options)
        if len(matches) == 1:
            brand = matches[0].name
            break
    for source in sources:
        if series := SERIES.search(source):
            title = series[0]
            if not brand:
                prefix = source[:series.start()].splitlines()[-1:]
                label = prefix[0].strip(' -:|') if prefix else ''
                if re.fullmatch(r'[A-Za-z][A-Za-z0-9 &.-]{1,45}', label):
                    brand = label
            break
    business = sub = ''
    for source in sources:
        for kind, category, pattern in RULES:
            if category in SUB_CATEGORIES[kind] and re.search(pattern, source, re.I):
                business, sub = kind, category
                break
        if business:
            break
    return {'brand_name': brand[:200], 'catalogue_title': (title or filename)[:200],
            'business_type': business, 'sub_business': sub, 'page_count': page_count}
