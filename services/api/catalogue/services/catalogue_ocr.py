"""Read OCR text in displayed PDF page coordinates."""

from dataclasses import dataclass
import csv
from io import StringIO
import shutil
import subprocess
from threading import Lock


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


_engine = None
_lock = Lock()


def read_page(page):
    global _engine
    import numpy as np
    import pymupdf

    dpi = min(140, int(72 * 1800 / max(page.rect.width, page.rect.height)))
    if dpi < 1:
        return []
    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False)
    pixels = np.frombuffer(pixmap.samples_mv, dtype=np.uint8).reshape(pixmap.height, pixmap.width)
    if int(pixels.max()) - int(pixels.min()) < 12:
        return []
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR
            _engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1,
                               det_limit_side_len=960, det_limit_type='max',
                               rec_rec_img_shape=[3, 48, 96])
        detections, _ = _engine(pixels, use_cls=False)
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
    dpi = min(275, int(72 * 4000 / max(page.rect.width, page.rect.height)))
    if dpi < 1 or timeout <= 0:
        return [], 'Tesseract was skipped because the extraction time budget was reached.'
    import pymupdf

    pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False)
    try:
        result = subprocess.run([executable, 'stdin', 'stdout', '--psm', '6', 'tsv'],
                                input=pixmap.tobytes('png'), capture_output=True,
                                timeout=min(timeout, 25), check=True)
    except subprocess.TimeoutExpired:
        return [], 'Tesseract timed out. Try extracting a smaller range or a clearer scan.'
    except (OSError, subprocess.CalledProcessError):
        return [], 'Tesseract could not read this page. Check the local OCR installation.'
    scale = 72 / dpi
    boxes = []
    for word in csv.DictReader(StringIO(result.stdout.decode('utf-8', errors='replace')), delimiter='\t'):
        if word['level'] == '5' and word['text'] and word['text'].strip():
            x, y, width, height = (int(word[key]) for key in ('left', 'top', 'width', 'height'))
            boxes.append(TextBox(x * scale, y * scale, (x + width) * scale, (y + height) * scale, word['text'].strip()))
    return boxes, ''
