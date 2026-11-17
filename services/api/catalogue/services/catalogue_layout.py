"""Read independent price tables using their headers and positioned text."""

from dataclasses import dataclass, field, replace
from decimal import Decimal
from itertools import takewhile
import re

from .catalogue_ocr import TextBox


HSN = re.compile(r'\bHSN(?:\s*/\s*SAC)?(?:\s+CODE|\s+NO\.?)?\s*[:.-]?\s*(\d{4,8})\b', re.I)
SKU = re.compile(r'(?=.*\d)[A-Za-z0-9][A-Za-z0-9./_-]{0,99}\Z')
NOISE = re.compile(
    r'^\s*(?:table of contents\b|contents\s*$|index\s*$|page\s+\d+\b|'
    r'price list\s*(?:w\.?\s*e\.?\s*f\.?|effective)\b|'
    r'warranty applicable\b|flowguard\s*plus\b|'
    r'(?:revised|introducing shortly|speciality|new)(?:\s*[/·|]\s*|\s*$)|'
    r'prices?\s*[:.-]?\s*available on request\b|.*\bprice\s*list\s*$|terms and conditions\b|notes?\s*:)', re.I,
)
CONTENTS = re.compile(r'^\s*(?:table of contents|contents|index)\s*$', re.I)
ON_REQUEST = re.compile(r'^\s*prices?\s*[:.-]?\s*available on request\b', re.I)
SYSTEM = re.compile(
    r'\b(?:CPVC|UPVC|SWR|(?:plumbing|drainage|piping) system|underground drainage|inspection chambers)\b', re.I,
)
LENGTH = re.compile(r'\b(\d+(?:[./]\d+)?)\s*(?:mtr(?:s)?|metres?|meters?|m)\b', re.I)
ALIASES = {
    'name': ('name', 'item name', 'product', 'product name', 'description', 'product description', 'particulars', 'item description'),
    'code': ('code', 'item code', 'catalogue no', 'catalog no', 'cat no', 'cat number', 'product code', 'part no',
             'part number', 'item no', 'sku', 'ref no', 'model', 'material code'),
    'price': ('mrp', 'mrp rs', 'price', 'rate', 'unit price', 'list price', 'price per unit', 'mrp inr'),
    'hsn': ('hsn', 'hsn code', 'hsn sac', 'hsn sac code', 'sac'),
    'size_cm': ('size cm', 'size in cm', 'cm'),
    'size_inch': ('size inch', 'size in inch', 'size inches', 'inches', 'inch'),
    'size': ('size', 'diameter', 'size mm', 'size in mm', 'capacity', 'volume'),
    'pack': ('std pkg', 'std pk', 'std pack', 'std packing', 'std package', 'standard packing', 'std qty',
             'pack', 'pack size', 'packing'),
    'box': ('box qty', 'box quantity', 'master pack', 'master carton'),
    'turn': ('turn', 'turns'),
    'knob': ('knob', 'knob type'),
    'module': ('module', 'modules', 'module size'),
    'rating': ('rating', 'ampere', 'amperes'),
    'category': ('category', 'sub category', 'segment'),
    'image': ('image', 'photo', 'picture'),
}
HEADER_KEYS = {alias: key for key, aliases in ALIASES.items() for alias in aliases}
DESCRIPTORS = {'name', 'size', 'size_cm', 'size_inch'}


@dataclass(frozen=True)
class Column:
    key: str
    left: float
    right: float
    length: str = ''


@dataclass
class LayoutRow:
    cells: dict
    code: str
    amount: Decimal
    group: str
    hsn: str
    category: str
    length: str
    bounds: tuple
    section: int
    image_bounds: tuple | None = None
    pack: dict = field(default_factory=dict)


def native_boxes(page):
    import pymupdf

    return [TextBox(*tuple(pymupdf.Rect(word[:4]) * page.rotation_matrix), word[4])
            for word in page.get_text('words')]


def lines_of(boxes):
    lines = []
    for box in sorted(boxes, key=lambda item: (item.center, item.x0)):
        if not box.text.strip():
            continue
        if not lines or box.center - lines[-1][0].center > min(3, max(1.5, (box.bottom - box.top) * .35)):
            lines.append([])
        lines[-1].append(box)
    return [sorted(line, key=lambda box: box.x0) for line in lines]


def line_text(line):
    return ' '.join(box.text for box in line)


def header_key(text):
    return re.sub(r'[^a-z0-9]+', ' ', text.casefold()).strip()


def header_columns(line):
    columns = []
    index = 0
    while index < len(line):
        match = None
        for end in range(index + 1, min(index + 8, len(line)) + 1):
            if end > index + 1 and line[end - 1].x0 - line[end - 2].x1 > 7:
                break
            text = line_text(line[index:end])
            length = LENGTH.search(text)
            key = HEADER_KEYS.get(header_key(LENGTH.sub('', text)))
            if key and (not length or key in {'code', 'price'}):
                match = (end, Column(key, line[index].x0, line[end - 1].x1, f'{length[1]} mtr' if length else ''))
        if match:
            index, column = match
            columns.append(column)
        else:
            index += 1
    return columns


def header_groups(line):
    columns = header_columns(line)
    groups = []
    start = 0
    has_code = has_price = False
    for index, column in enumerate(columns):
        # A new descriptor after a complete code/price pair starts the next
        # side-by-side table. A second code/price pair alone is a pipe length.
        tail = columns[index + 1:]
        new_descriptor = column.key in DESCRIPTORS and any(item.key == 'code' for item in tail)
        code_first = column.key == 'code' and not column.length and any(
            item.key in DESCRIPTORS for item in takewhile(lambda item: item.key != 'price', tail))
        if has_code and has_price and (new_descriptor or code_first):
            groups.append(columns[start:index])
            start = index
            has_code = has_price = False
        has_code |= column.key == 'code'
        has_price |= column.key == 'price'
    groups.append(columns[start:])
    return [group for group in groups if {'code', 'price'} <= {column.key for column in group}]


def horizontal_bands(headers, width):
    spans = sorted((group[0].left, group[-1].right) for group in headers)
    merged = []
    for left, right in spans:
        if merged and left < merged[-1][1] + 7:
            merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
        else:
            merged.append((left, right))
    gutters = [0, *((a[1] + b[0]) / 2 for a, b in zip(merged, merged[1:])), width]
    return list(zip(gutters, gutters[1:]))


def values_at(line, columns):
    values = [''] * len(columns)
    for box in line:
        index = 0
        for offset in range(1, len(columns)):
            previous, column = columns[offset - 1:offset + 1]
            boundary = column.left - min(12, max(2, (column.left - previous.right) / 3))
            if box.x0 < boundary:
                break
            index = offset
        values[index] = (values[index] + ' ' + box.text).strip()
    return values


def parse_band(lines, left, right, parse_price):
    output = []
    columns = []
    group = category = hsn = ''
    context = ''
    section = 0
    previous = []
    header_bottom = None
    wrapped_name = None
    for line in lines:
        text = line_text(line)
        top = min(box.top for box in line)
        bottom = max(box.bottom for box in line)
        if NOISE.match(text) or re.fullmatch(r'\d+', text):
            previous = []
            wrapped_name = None
            continue
        if match := HSN.search(text):
            heading = text[:match.start()].strip(' -–—:|')
            group = heading or context
            context = ''
            hsn = match[1]
            section += 1
            previous = []
            wrapped_name = None
            continue
        headers = header_groups(line)
        if headers:
            columns = headers[0]
            if context:
                group = context
                hsn = ''
                section += 1
            context = ''
            previous = []
            wrapped_name = None
            header_bottom = bottom
            continue
        if SYSTEM.search(text) and len(text) <= 80 and not re.search(r'\d', text):
            category = text
            group = hsn = context = ''
            columns = previous = []
            wrapped_name = None
            continue
        values = values_at(line, columns) if columns else []
        if header_bottom is not None and top - header_bottom <= 8:
            # Some pipe lists put the length on a second header baseline.
            qualifiers = [(index, LENGTH.search(value)) for index, value in enumerate(values) if value]
            if qualifiers and all(match and columns[index].key in {'code', 'price'} and
                                  not header_key(LENGTH.sub('', values[index])) for index, match in qualifiers):
                for index, match in qualifiers:
                    columns[index] = replace(columns[index], length=f'{match[1]} mtr')
                header_bottom = bottom
                continue
        header_bottom = None
        pairs = list(zip((i for i, column in enumerate(columns) if column.key == 'code'),
                         (i for i, column in enumerate(columns) if column.key == 'price')))
        cells = {column.key: value for column, value in zip(columns, values) if value and column.key not in {'code', 'price'}}
        variants = []
        for code_index, price_index in pairs:
            code = re.sub(r'\s*([/-])\s*', r'\1', values[code_index])
            amount = parse_price(values[price_index])
            if SKU.fullmatch(code) and amount is not None:
                variants.append((code, amount, columns[code_index].length or columns[price_index].length))
        if variants and wrapped_name and 0 <= top - wrapped_name[1] <= 7:
            cells['name'] = ' '.join(filter(None, (wrapped_name[0], cells.get('name'))))
        wrapped_name = None
        if variants and (group or cells.get('name')):
            context = ''
            previous = []
            image_column = next((i for i, column in enumerate(columns) if column.key == 'image'), None)
            image_bounds = ((left if image_column == 0 else columns[image_column].left,
                             columns[image_column + 1].left - 5)
                            if image_column is not None and image_column + 1 < len(columns) else None)
            pack = {label: cells[key] for key, label in [('pack', 'standard'), ('box', 'box_quantity')] if key in cells}
            for code, amount, length in variants:
                row_hsn = cells.get('hsn', hsn)
                row = LayoutRow(cells.copy(), code, amount, group, row_hsn if re.fullmatch(r'\d{4,8}', row_hsn) else '',
                                cells.get('category', category), length, (left, top, right, bottom),
                                section, image_bounds, pack)
                output.append(row)
                previous.append(row)
        elif previous and top - previous[0].bounds[3] <= 7 and cells and (
                set(cells) <= {'name', 'size', 'size_cm', 'size_inch', 'turn', 'knob'}) and not any(
                    values[a] or values[b] for a, b in pairs):
            for row in previous:
                for key, value in cells.items():
                    row.cells[key] = (row.cells.get(key, '') + ' ' + value).strip()
                row.bounds = (*row.bounds[:3], bottom)
        else:
            previous = []
            # Only promote a free-standing heading if a subsequent table header confirms it.
            if len(text) <= 100 and re.search('[A-Za-z]', text) and not any(
                    values[a] or values[b] for a, b in pairs):
                context = text
                if set(cells) == {'name'}:
                    wrapped_name = cells['name'], bottom
    return output


def layout_rows(boxes, width, parse_price):
    lines = lines_of(boxes)
    headers = [group for line in lines if not NOISE.match(line_text(line)) for group in header_groups(line)]
    if not headers:
        return [], 0, False
    bands = horizontal_bands(headers, width)
    rows = []
    for left, right in bands:
        block = [[box for box in line if left <= (box.x0 + box.x1) / 2 < right] for line in lines]
        rows.extend(parse_band([line for line in block if line], left, right, parse_price))
    advanced = len(bands) > 1 or any(
        column.key in {'size', 'size_cm', 'size_inch', 'turn', 'knob', 'pack', 'box'} or column.length
        for header in headers for column in header
    ) or any(HSN.search(line_text(line)) for line in lines)
    return rows, len({(row.bounds[0], row.section) for row in rows}), advanced


def skip_reason(boxes):
    lines = lines_of(boxes)
    titles = [line_text(line) for line in lines[:6]]
    if any(CONTENTS.fullmatch(title) for title in titles):
        return 'table_of_contents'
    if any(ON_REQUEST.match(title) for title in titles) and not any(header_groups(line) for line in lines):
        return 'prices_on_request'
    return ''
