"""Read OCR text in displayed PDF page coordinates."""

from dataclasses import dataclass
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
