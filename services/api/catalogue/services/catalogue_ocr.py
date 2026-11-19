"""Read OCR text in displayed PDF page coordinates."""

from dataclasses import dataclass
import csv
from io import BytesIO, StringIO
import json
import shutil
import subprocess
import sys

RAPID_OCR_SECONDS = 32
OCR_PAGE_SECONDS = 44
MAX_RENDER_SIDE = 2200


@dataclass(frozen=True)
class TextBox:
    x0: float
    top: float
    x1: float
    bottom: float
    text: str

    @property
    def center(self):
        return (self.top + self.bottom) / 2


class OCRPageTimeout(TimeoutError):
    """A single OCR attempt exceeded its time budget."""


def render_page(page, dpi):
    import pymupdf
    from PIL import Image, ImageOps

    dpi = min(dpi, int(72 * (MAX_RENDER_SIDE - 2) / max(page.rect.width, page.rect.height)))
    if dpi < 1:
        return None, dpi
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False)
    image = Image.frombytes('L', (pixmap.width, pixmap.height), pixmap.samples)
    low, high = image.getextrema()
    if high - low < 12:
        return None, dpi
    if high - low < 160:
        image = ImageOps.autocontrast(image)
    output = BytesIO()
    image.save(output, format='PNG', compress_level=1)
    return output.getvalue(), dpi


def read_page(page, timeout=RAPID_OCR_SECONDS):
    if timeout <= 0:
        raise OCRPageTimeout
    image, dpi = render_page(page, 140)
    if image is None:
        return []
    # A subprocess lets the API terminate stalled ONNX inference and release memory.
    try:
        result = subprocess.run([sys.executable, __file__], input=image, capture_output=True,
                                timeout=timeout, check=True)
    except subprocess.TimeoutExpired as error:
        raise OCRPageTimeout from error
    detections = json.loads(result.stdout)
    scale = 72 / dpi
    boxes = []
    for polygon, text, _ in detections or []:
        xs, ys = zip(*polygon)
        boxes.append(TextBox(min(xs) * scale, min(ys) * scale, max(xs) * scale, max(ys) * scale, text.strip()))
    return sorted(boxes, key=lambda box: (box.center, box.x0))


def read_page_tesseract(page, timeout):
    """Read individual OCR words in the same coordinate space as native text."""
    executable = shutil.which('tesseract')
    if not executable:
        return [], 'Tesseract is unavailable on this host.'
    if timeout <= 0:
        return [], 'Tesseract was skipped because the extraction time budget was reached.'
    image, dpi = render_page(page, 275)
    if image is None:
        return [], ''
    try:
        result = subprocess.run([executable, 'stdin', 'stdout', '--psm', '6', 'tsv'],
                                input=image, capture_output=True,
                                timeout=min(timeout, 25), check=True)
    except subprocess.TimeoutExpired:
        return [], 'Tesseract timed out. Try extracting a smaller range or a clearer scan.'
    except (OSError, subprocess.CalledProcessError):
        return [], 'Tesseract could not read this page. Check the local OCR installation.'
    scale = 72 / dpi
    boxes = []
    for word in csv.DictReader(StringIO(result.stdout.decode('utf-8', errors='replace')), delimiter='\t'):
        text = (word.get('text') or '').strip()
        if word.get('level') != '5' or not text:
            continue
        try:
            x, y, width, height = (int(word[key]) for key in ('left', 'top', 'width', 'height'))
        except (KeyError, TypeError, ValueError):
            continue
        if width > 0 and height > 0:
            boxes.append(TextBox(x * scale, y * scale, (x + width) * scale, (y + height) * scale, text))
    return boxes, ''


if __name__ == '__main__':
    import numpy as np
    from PIL import Image
    from rapidocr_onnxruntime import RapidOCR

    with Image.open(BytesIO(sys.stdin.buffer.read())) as image:
        pixels = np.asarray(image)
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1, det_limit_side_len=960,
                      det_limit_type='max', rec_rec_img_shape=[3, 48, 96])
    detections, _ = engine(pixels, use_cls=False)
    json.dump(detections or [], sys.stdout, default=lambda value: value.tolist())
