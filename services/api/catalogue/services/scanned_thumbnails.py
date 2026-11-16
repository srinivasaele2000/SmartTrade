"""Crop printed product photos from OCR page coordinates."""

from io import BytesIO
import re

import pymupdf as fitz
from PIL import Image


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


def crop_photo(page, bounds, text_boxes):
    photos = crop_photos(page, bounds, text_boxes)
    return max(photos, key=lambda photo: photo[2])[3] if photos else None


def crop_photos(page, bounds, text_boxes):
    import cv2
    import numpy as np

    clip = fitz.Rect(bounds) & page.rect
    if clip.is_empty or min(clip.width, clip.height) < 15:
        return []
    raster = page.get_pixmap(dpi=160, clip=clip, alpha=False)
    pixels = np.frombuffer(raster.samples_mv, dtype=np.uint8).reshape(raster.height, raster.width, 3)
    # Estimate the paper or panel color from the crop perimeter.
    edge = np.concatenate((pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]))
    background = np.median(edge, axis=0)
    mask = (np.max(np.abs(pixels - background), axis=2) > 38).astype(np.uint8)
    for box in text_boxes:
        scale = 160 / 72
        x0, x1 = int(box.x0 * scale) - raster.x, int(box.x1 * scale) - raster.x + 1
        y0, y1 = int(box.top * scale) - raster.y, int(box.bottom * scale) - raster.y + 1
        if x0 < raster.width and y0 < raster.height and x1 > 0 and y1 > 0:
            mask[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] = 0
    # Reject thin strokes and sparse outlines by size, shape and fill.
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    components = [(x, y, w, h, area) for x, y, w, h, area in stats[1:count]
                  if min(w, h) >= 32 and 0.35 <= w / h <= 2.8 and area >= w * h * 0.2]
    photos = []
    for x, y, width, height, area in components:
        margin = max(2, round(min(width, height) * 0.1))
        image = Image.fromarray(pixels).crop((max(0, x - margin), max(0, y - margin),
                                             min(raster.width, x + width + margin),
                                             min(raster.height, y + height + margin)))
        image.thumbnail((320, 320))
        output = BytesIO()
        image.convert('RGB').save(output, 'PNG')
        photos.append(((raster.y + y) * 72 / 160, (raster.y + y + height) * 72 / 160, area, output.getvalue()))
    return photos
