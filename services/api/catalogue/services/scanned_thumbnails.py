"""Crop printed product photos from OCR page coordinates."""

from io import BytesIO
import re

import pymupdf as fitz
from PIL import Image

from .catalogue_layout import lines_of
from .catalogue_ocr import TextBox


def caption_key(text):
    return re.sub(r'[^A-Z0-9]', '', text.upper()).replace('O', '0')

def matching_caption(code, captions):
    key = caption_key(code)
    exact = captions.get(key)
    if exact is not None:
        return next(iter(exact)) if len(exact) == 1 else None
    confusions = str.maketrans('ILS', '115')
    fuzzy = key.translate(confusions)
    matches = {box for label, boxes in captions.items()
               if label.translate(confusions) == fuzzy for box in boxes}
    if not matches:
        for suffix in ('W', 'G', 'WH', 'GY', 'BK', 'BL', 'RD', 'GR'):
            if key.endswith(suffix):
                base = key[:-len(suffix)]
                if re.search(r'\d{2,}$', base) and len(base) >= 4:
                    matches.update(captions.get(base, ()))
    return next(iter(matches)) if len(matches) == 1 else None


def left_gallery_photos(page, boxes, codes, table_left):
    """Find the photo above each SKU caption, independently of table row height."""
    captions = {}
    left_boxes = [box for box in boxes if box.x1 <= table_left]
    for line in lines_of(left_boxes):
        for box in line:
            text = box.text.strip()
            if re.fullmatch(r'[0-9OILS]{3}', text, re.I):
                suffix = min((word for word in left_boxes if word.x0 >= box.x1 - 2
                              and word.x0 - box.x1 <= max(9, (box.bottom - box.top) * 1.5)
                              and abs(word.bottom - box.bottom) <= max(3, (box.bottom - box.top) * .55)),
                             key=lambda word: word.x0, default=None)
                if suffix and re.fullmatch(r'[0-9OILS]{3}', suffix.text.strip(), re.I):
                    box = TextBox(box.x0, min(box.top, suffix.top), suffix.x1,
                                  max(box.bottom, suffix.bottom), text + suffix.text.strip())
                    text = box.text
            if re.fullmatch(r'[0-9OILS]{3}\s*[0-9OILS]{3}|(?=[A-Z0-9./_-]*[0-9])[A-Z][A-Z0-9./_-]{3,}', text, re.I):
                captions.setdefault(caption_key(text), set()).add(box)

    matches = {code: match for code in set(codes) if (match := matching_caption(code, captions))}
    gallery = {box for values in captions.values() for box in values}
    photos = {}
    for code, caption in matches.items():
        center = (caption.x0 + caption.x1) / 2
        width = max(60, 1.5 * (caption.x1 - caption.x0))
        left, right = max(page.rect.x0, center - width), min(table_left, center + width)
        above = max(page.rect.y0, caption.top - 210)
        for neighbor in gallery - {caption}:
            other = (neighbor.x0 + neighbor.x1) / 2
            if abs(neighbor.center - caption.center) <= 8:
                if other < center:
                    left = max(left, (other + center) / 2)
                elif other > center:
                    right = min(right, (other + center) / 2)
            elif neighbor.bottom < caption.top and abs(other - center) < width * .7:
                above = max(above, neighbor.bottom + 2)
        for heading in lines_of(left_boxes):
            if (heading[0].top > above and heading[-1].bottom < caption.top
                    and heading[0].x0 < right and heading[-1].x1 > left
                    and re.search(r'\bswitches\b|\bseries\b', ' '.join(word.text for word in heading), re.I)):
                above = max(above, max(word.bottom for word in heading) + 2)
        components = crop_photos(page, (left, above, right, caption.top - 1), left_boxes, gallery=True)
        if components:
            # Prefer the product silhouette over smaller nearby marks.
            photos[code] = max(components, key=lambda component: (component[2], component[1]))[3]
    return photos, matches.keys()


def crop_photo(page, bounds, text_boxes):
    photos = crop_photos(page, bounds, text_boxes)
    return max(photos, key=lambda photo: photo[2])[3] if photos else None


def crop_photos(page, bounds, text_boxes, *, gallery=False):
    import cv2
    import numpy as np

    clip = fitz.Rect(bounds) & page.rect
    if clip.is_empty or min(clip.width, clip.height) < 15:
        return []
    dpi = min(160, int(72 * 2198 / max(clip.width, clip.height)))
    if dpi < 1:
        return []
    scale = dpi / 72
    raster = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
    pixels = np.frombuffer(raster.samples_mv, dtype=np.uint8).reshape(raster.height, raster.width, 3)
    # Estimate the paper or panel color from the crop perimeter.
    edge = np.concatenate((pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]))
    background = np.median(edge, axis=0)
    mask = (np.max(np.abs(pixels - background), axis=2) > (18 if gallery else 38)).astype(np.uint8)
    for box in text_boxes:
        x0, x1 = int(box.x0 * scale) - raster.x, int(box.x1 * scale) - raster.x + 1
        y0, y1 = int(box.top * scale) - raster.y, int(box.bottom * scale) - raster.y + 1
        if x0 < raster.width and y0 < raster.height and x1 > 0 and y1 > 0:
            mask[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] = 0
    if gallery:
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8))
    min_aspect, max_aspect, min_fill = (.14, 3.5, .12) if gallery else (.35, 2.8, .2)
    # Reject thin strokes and sparse outlines by size, shape and fill.
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    components = [(x, y, w, h, area) for x, y, w, h, area in stats[1:count]
                  if min(w, h) >= max(16, round(14.4 * scale)) and min_aspect <= w / h <= max_aspect and area >= w * h * min_fill]
    photos = []
    for x, y, width, height, area in components:
        margin = max(2, round(min(width, height) * 0.1))
        image = Image.fromarray(pixels).crop((max(0, x - margin), max(0, y - margin),
                                             min(raster.width, x + width + margin),
                                             min(raster.height, y + height + margin)))
        image.thumbnail((320, 320))
        output = BytesIO()
        image.convert('RGB').save(output, 'PNG')
        photos.append(((raster.y + y) / scale, (raster.y + y + height) / scale, area, output.getvalue()))
    return photos
