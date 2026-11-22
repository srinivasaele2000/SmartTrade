"""Read independent price tables using their headers and positioned text."""

from dataclasses import asdict, dataclass, field, replace
from decimal import Decimal
from itertools import takewhile
import re

from .catalogue_ocr import TextBox


HSN = re.compile(r'\bHSN(?:\s*/\s*SAC)?(?:\s+CODE|\s+NO\.?)?\s*[:.-]?\s*(\d{4,8})\b', re.I)
SPACED_SKU = re.compile(r'[0-9]{3}\s+[0-9]{3}\Z')
SKU = re.compile(r'(?=.*\d)[A-Za-z0-9][A-Za-z0-9./_-]{0,99}\Z')
NOISE = re.compile(
    r'^\s*(?:table of contents\b|contents\s*$|index\s*$|page\s+\d+\b|'
    r'price list\s*(?:w\.?\s*e\.?\s*f\.?|effective)\b|'
    r'warranty applicable\b|flowguard\s*plus\b|'
    r'(?:revised|introducing shortly|speciality|new)(?:\s*[/·|]\s*|\s*$)|'
    r'(?:all prices|prices are|subject to change|gst extra|effective from|contact us)\b|'
    r'prices?\s*[:.-]?\s*available on request\b|.*\bprice\s*list\b|terms and conditions\b|notes?\s*:)', re.I,
)
CONTENTS = re.compile(r'^\s*(?:table of contents|contents|index)\s*$', re.I)
ON_REQUEST = re.compile(r'^\s*prices?\s*[:.-]?\s*available on request\b', re.I)
SYSTEM = re.compile(
    r'\b(?:CPVC|UPVC|SWR|(?:plumbing|drainage|piping) system|underground drainage|inspection chambers)\b', re.I,
)
LENGTH = re.compile(r'\b(\d+(?:[./]\d+)?)\s*(?:mtr(?:s)?|metres?|meters?|m)\b', re.I)
DIMENSION = re.compile(
    r'(?<!\w)(?:\d+(?:[./]\d+)?\s*(?:sq\.?\s*mm|mm[²2]?|cm|inch(?:es)?|kW|mA|AX|A|W|M|V|")|SPN|TPN|SP|DP|TP|FP)(?!\w)', re.I,
)
PACK_CONTEXT = re.compile(
    r'\b(?P<kind>std\.?\s*(?:pkg|pk|pack(?:ing)?)|standard\s+pack(?:ing)?|box\s+(?:qty|quantity)|master\s+pack)'
    r'\.?\s*[:=–-]?\s*(?P<value>\d+(?:\s*(?:pcs\.?|units?))?)(?!\w)', re.I,
)
SECTION = re.compile(r'^\s*(?:series|section|sub[ -]?category)\s*[:–-]\s*(.+)', re.I)
SWITCHGEAR_SERIES = re.compile(r'^E[\s‐‑–-]*(?:Square|Soft|Flat)\b.*\bSwitch(?:es)?\b', re.I)
DETAIL_COLUMNS = {'name', 'size', 'size_cm', 'size_inch', 'turn', 'knob', 'module', 'rating', 'way',
                  'electrical_details', 'pole', 'wattage', 'finish', 'standard'}
FACT_COLUMNS = {
    'size': 'Size', 'size_cm': 'Size (cm)', 'size_inch': 'Size (inch)', 'turn': 'Turn',
    'knob': 'Knob', 'module': 'Module', 'rating': 'Rating', 'way': 'Ways',
    'electrical_details': 'Electrical details', 'pole': 'Pole configuration', 'wattage': 'Wattage',
    'finish': 'Finish', 'standard': 'Standard',
}


def column_variant(text):
    if length := LENGTH.fullmatch(text.strip(' ()')):
        return f'{length[1]} mtr'
    if DIMENSION.fullmatch(text.strip(' ()')):
        return ' '.join(text.strip(' ()').split())
    return ''


def code_value(value):
    if SPACED_SKU.fullmatch(value.strip()):
        return ''.join(value.split())
    return re.sub(r'\s*([/-])\s*', r'\1', value.strip().replace('–', '-').replace('‑', '-'))


ALIASES = {
    'name': ('name', 'item', 'item name', 'product', 'product name', 'description', 'product description', 'particulars', 'item description'),
    'code': ('code', 'item code', 'catalogue no', 'catalog no', 'cat no', 'cat number', 'cat no item code', 'item code cat no', 'product code', 'part no',
             'part number', 'item no', 'sku', 'ref no', 'model', 'material code', 'model no', 'model number', 'ref number', 'part code',
             'pro code', 'prod code'),
    'price': ('mrp', 'mrp rs', 'price', 'rate', 'unit price', 'list price', 'price per unit', 'mrp inr', 'lp', 'lp rs', 'rate rs', 'mrp per unit', 'mrp unit', 'list price rs', 'list price inr'),
    'hsn': ('hsn', 'hsn code', 'hsn sac', 'hsn sac code', 'sac'),
    'size_cm': ('size cm', 'size in cm', 'cm'),
    'size_inch': ('size inch', 'size in inch', 'size inches', 'inches', 'inch'),
    'size': ('size', 'diameter', 'size mm', 'size in mm', 'capacity', 'volume'),
    'pack': ('std pkg', 'std pk', 'std pack', 'std packing', 'std package', 'standard packing', 'std qty',
             'pack', 'pack size', 'packing'),
    'box': ('box qty', 'box quantity', 'master pack', 'master carton'),
    'combined_pack': ('std mst pkg', 'std mst pack', 'std master pkg'),
    'neo_white_mrp': ('neo white', 'neo white mrp', 'neo white mrp rs'),
    'grey_black_mrp': ('grey black', 'grey black mrp', 'grey black mrp rs', 'gray black', 'gray black mrp', 'gray black mrp rs'),
    'turn': ('turn', 'turns'),
    'knob': ('knob', 'knob type'),
    'module': ('mod', 'mods', 'module', 'modules', 'module size'),
    'rating': ('rating', 'amp', 'amps', 'ampere', 'amperes'),
    'way': ('way', 'ways', 'no of ways'),
    'electrical_details': ('mod amp way', 'module amp way'),
    'category': ('category', 'sub category', 'segment'),
    'pole': ('pole', 'poles', 'pole configuration'),
    'wattage': ('wattage', 'watts', 'watt'),
    'finish': ('color', 'colour', 'finish', 'color finish', 'colour finish'),
    'standard': ('standard', 'certification'),
    'image': ('image', 'photo', 'picture'),
}
HEADER_KEYS = {alias: key for key, aliases in ALIASES.items() for alias in aliases}
COMPACT_HEADERS = {alias.replace(' ', ''): key for alias, key in HEADER_KEYS.items()}
DESCRIPTORS = {'name', 'size', 'size_cm', 'size_inch'}
FINISH_MRPS = {'neo_white_mrp', 'grey_black_mrp'}


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
    series: str = ''
    matrix: bool = False
    wrapped: bool = False
    finish_prices: dict = field(default_factory=dict)


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
    key = re.sub(r'[^a-z0-9]+', ' ', text.casefold()).strip()
    return re.sub(r'\bm\s+r\s+p\b', 'mrp', key)


def header_columns(line):
    separated = []
    for box in line:
        compact = header_key(box.text).replace(' ', '')
        # RapidOCR may return the last MRP and packing headers as one box.
        merged = re.fullmatch(r'((?:grey|gray)blackmrp(?:rs)?)(std(?:mst|master)(?:pkg|pack))', compact)
        if merged:
            boundary = box.x0 + (box.x1 - box.x0) * len(merged[1]) / len(compact)
            separated.extend((replace(box, x1=boundary, text=merged[1]),
                              replace(box, x0=boundary, text=merged[2])))
        else:
            separated.append(box)
    line = separated
    columns = []
    index = 0
    while index < len(line):
        match = None
        for end in range(index + 1, min(index + 8, len(line)) + 1):
            if end > index + 1 and line[end - 1].x0 - line[end - 2].x1 > 7:
                break
            text = line_text(line[index:end])
            normalized = header_key(text)
            key = HEADER_KEYS.get(normalized) or COMPACT_HEADERS.get(normalized.replace(' ', ''))
            qualifier = ''
            if not key:
                variant = LENGTH.search(text) or DIMENSION.search(text)
                if variant:
                    key = HEADER_KEYS.get(header_key(text[:variant.start()] + text[variant.end():]))
                    qualifier = column_variant(variant[0])
                    if key not in {'code', 'price'}:
                        key = None
            if key:
                match = (end, Column(key, line[index].x0, line[end - 1].x1, qualifier))
        if match:
            index, column = match
            columns.append(column)
        else:
            index += 1
    return columns


def header_groups(line):
    columns = header_columns(line)
    if FINISH_MRPS <= {column.key for column in columns} and sum(column.key == 'code' for column in columns) == 1:
        columns = [column for column in columns if column.key != 'price']
    groups = []
    start = 0
    has_code = has_price = False
    for index, column in enumerate(columns):
        # A new descriptor after a complete code/price pair starts the next
        # side-by-side table. A second code/price pair alone is a pipe length.
        tail = columns[index + 1:]
        new_descriptor = column.key in DESCRIPTORS and any(item.key == 'code' for item in tail)
        code_first = column.key == 'code' and not column.length and any(
            item.key in DESCRIPTORS for item in takewhile(lambda item: item.key not in {'price', 'neo_white_mrp'}, tail))
        if has_code and has_price and (new_descriptor or code_first):
            groups.append(columns[start:index])
            start = index
            has_code = has_price = False
        has_code |= column.key == 'code'
        has_price |= column.key in {'price', 'neo_white_mrp'}
    groups.append(columns[start:])
    return [group for group in groups if any(column.key == 'code' for column in group)
            and any(column.key in {'price', 'neo_white_mrp'} for column in group)]


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


def matrix_pairs(columns):
    return list(zip((i for i, column in enumerate(columns) if column.key == 'code'),
                    (i for i, column in enumerate(columns) if column.key in {'price', 'neo_white_mrp'})))


def apply_matrix_headers(columns, labels):
    pairs = matrix_pairs(columns)
    if len(pairs) < 2 or len(labels) != len(pairs):
        return False
    if any(not column_variant(label.text) for label in labels):
        return False
    for label, (code, amount) in zip(labels, pairs):
        left, right = sorted((columns[code].left, columns[amount].left))
        center = (label.x0 + label.x1) / 2
        if not left - 18 <= center <= right + 35:
            return False
    for label, (code, _) in zip(labels, pairs):
        columns[code] = replace(columns[code], length=column_variant(label.text))
    return True


def parse_band(lines, left, right, parse_price, inherited):
    output = []
    columns = [Column(**column) for column in inherited.get('columns', [])]
    group = inherited.get('group', '')
    category = inherited.get('category', '')
    series = inherited.get('series', '')
    hsn = inherited.get('hsn', '')
    default_pack = dict(inherited.get('pack', {}))
    context = ''
    section = 0
    previous = []
    previous_line = []
    header_bottom = None
    wrapped_name = None
    for line in lines:
        text = line_text(line)
        top = min(box.top for box in line)
        bottom = max(box.bottom for box in line)
        if NOISE.match(text) or re.fullmatch(r'\d+', text):
            previous = []
            wrapped_name = None
            previous_line = []
            continue
        headings = header_groups(line)
        heading = SECTION.match(text)
        pack_matches = list(PACK_CONTEXT.finditer(text))
        hsn_match = HSN.search(text)
        switchgear_heading = SWITCHGEAR_SERIES.match(text)
        if heading or switchgear_heading or ((hsn_match or pack_matches) and not headings):
            title = PACK_CONTEXT.sub('', HSN.sub('', heading[1] if heading else text)).strip(' -–—:|,')
            if title:
                group = '' if heading or switchgear_heading else title
                series, hsn, default_pack = title, '', {}
            elif context and hsn_match:
                group = context
            if hsn_match:
                hsn = hsn_match[1]
            for match in pack_matches:
                key = 'standard' if match['kind'].casefold().startswith(('std', 'standard')) else 'box_quantity'
                default_pack[key] = match['value']
            context = ''
            section += 1
            previous = []
            wrapped_name = None
            previous_line = []
            continue
        if headings:
            new_columns = headings[0]
            if not output and inherited and columns and not section and (
                len(new_columns) != len(columns) or any(
                    a.key != b.key or abs(a.left - b.left) > 20 for a, b in zip(new_columns, columns)
                )
            ):
                group = category = series = hsn = ''
                default_pack = {}
            columns = new_columns
            if context:
                group = series = context
                hsn, default_pack = '', {}
                section += 1
            if previous_line and 0 <= top - max(box.bottom for box in previous_line) <= 18:
                apply_matrix_headers(columns, previous_line)
            context = ''
            previous = []
            wrapped_name = None
            previous_line = []
            header_bottom = bottom
            continue
        if SYSTEM.search(text) and len(text) <= 80 and not re.search(r'\d', text):
            category = series = text
            group = hsn = context = ''
            default_pack = {}
            columns = previous = []
            wrapped_name = None
            previous_line = []
            continue
        if not previous and len(line) > 1 and all(column_variant(box.text) for box in line):
            previous_line = line
            continue
        values = values_at(line, columns) if columns else []
        if header_bottom is not None and top - header_bottom <= 8:
            if apply_matrix_headers(columns, line):
                header_bottom = bottom
                continue
            # A qualifier may also be printed directly under just one header cell.
            qualifiers = [(index, column_variant(value)) for index, value in enumerate(values) if value]
            if qualifiers and all(qualifier and columns[index].key in {'code', 'price'} for index, qualifier in qualifiers):
                for index, qualifier in qualifiers:
                    columns[index] = replace(columns[index], length=qualifier)
                header_bottom = bottom
                continue
        header_bottom = None
        pairs = matrix_pairs(columns)
        cells = {column.key: value for column, value in zip(columns, values)
                 if value and column.key not in {'code', 'price', 'neo_white_mrp', 'grey_black_mrp'}}
        variants = []
        for code_index, price_index in pairs:
            code = code_value(values[code_index])
            amount = parse_price(values[price_index])
            if SKU.fullmatch(code) and amount is not None:
                variants.append((code, amount, columns[code_index].length or columns[price_index].length))
        if variants and wrapped_name and -3 <= top - wrapped_name[1] <= 7:
            cells['name'] = ' '.join(filter(None, (wrapped_name[0], cells.get('name'))))
        wrapped = bool(variants and wrapped_name and -3 <= top - wrapped_name[1] <= 7)
        wrapped_name = None
        if variants and (group or cells.get('name')):
            context = ''
            previous = []
            image_column = next((i for i, column in enumerate(columns) if column.key == 'image'), None)
            image_bounds = ((left if image_column == 0 else columns[image_column].left,
                             columns[image_column + 1].left - 5)
                            if image_column is not None and image_column + 1 < len(columns) else None)
            pack = {**default_pack, **{label: cells[key] for key, label in
                                       [('pack', 'standard'), ('box', 'box_quantity')] if key in cells}}
            if combined_pack := re.fullmatch(r'(\d+)\s*/\s*(\d+)', cells.get('combined_pack', '')):
                pack.update(standard=combined_pack[1], box_quantity=combined_pack[2])
            secondary = parse_price(next((value for column, value in zip(columns, values)
                                          if column.key == 'grey_black_mrp'), ''))
            finish_prices = {'MRP finish': 'Neo White'} if any(column.key == 'neo_white_mrp' for column in columns) else {}
            if finish_prices and cells.get('name'):
                cells['name'] = re.sub(r'(\d+\s*A(?:\s*X)?)\s*(?=\d+\s*way)', r'\1 ', cells['name'], flags=re.I)
                cells['name'] = re.sub(r'\b(\d+)\s*way\s*(?=switch)', r'\1 Way ', cells['name'], flags=re.I)
            if secondary is not None:
                finish_prices['Grey/Black MRP'] = str(secondary)
            if re.fullmatch(r'\d{4,8}', cells.get('hsn', '')):
                hsn = cells['hsn']
            for code, amount, length in variants:
                row = LayoutRow(cells.copy(), code, amount, group, hsn, cells.get('category', category),
                                length, (left, top, right, bottom), section, image_bounds, pack,
                                cells.get('category') or series or category, len(pairs) > 1, wrapped,
                                finish_prices.copy())
                output.append(row)
                previous.append(row)
        elif (previous and -3 <= top - previous[0].bounds[3] <= 8 and cells
              and set(cells) <= DETAIL_COLUMNS and not any(values[a] or values[b] for a, b in pairs)
              and (not text.isupper() or bool(DIMENSION.search(text)) or re.fullmatch(r'(?:(?:MATTE|GLOSSY) )?(?:WHITE|BLACK|IVORY|CHROME|GREY|GRAY|SILVER)|ISI|BIS', text))):
            for row in previous:
                for key, value in cells.items():
                    row.cells[key] = (row.cells.get(key, '') + ' ' + value).strip()
                row.bounds = (*row.bounds[:3], bottom)
                row.wrapped = True
        else:
            previous = []
            # Promote isolated labels only with a following header or strong section cues.
            if len(text) <= 100 and re.search('[A-Za-z]', text) and not any(values[a] or values[b] for a, b in pairs):
                if text.isupper() and not DIMENSION.search(text) and len(text.split()) <= 6 and columns:
                    group = ''
                    series = text
                    hsn, default_pack = '', {}
                    section += 1
                    context = ''
                else:
                    context = text
                    if set(cells) == {'name'}:
                        wrapped_name = cells['name'], bottom
        previous_line = line
    return output, {'columns': [asdict(column) for column in columns], 'group': group,
                    'category': category, 'series': series, 'hsn': hsn, 'pack': default_pack}


def join_finish_headers(lines):
    """Merge stacked finish labels with the neighboring code/item header baseline."""
    joined = []
    index = 0
    while index < len(lines):
        line = lines[index]
        keys = {column.key for column in header_columns(line)}
        if index + 1 < len(lines) and (keys & (FINISH_MRPS | {'code', 'name'})):
            next_line = lines[index + 1]
            next_keys = {column.key for column in header_columns(next_line)}
            required = FINISH_MRPS | {'code', 'name'}
            if (required <= keys | next_keys and not required <= keys and not required <= next_keys
                    and next_line[0].center - line[0].center <= 20
                    and not (keys & next_keys & {'code', 'name'})):
                # MRP-only words on the other baseline overlap the finish
                # label boxes. Preserve the recognized column positions.
                columns = sorted(header_columns(line) + header_columns(next_line), key=lambda column: column.left)
                line = [TextBox(column.left, line[0].top, column.right, next_line[0].bottom, ALIASES[column.key][0])
                        for column in columns if column.key != 'price']
                index += 1
        joined.append(line)
        index += 1
    return joined


def layout_rows(boxes, width, parse_price, *, context=None):
    lines = join_finish_headers(lines_of(boxes))
    headers = [group for line in lines if not NOISE.match(line_text(line)) for group in header_groups(line)]
    inherited = context.get('bands', []) if context and abs(context.get('width', 0) - width) < 2 else []
    if not headers and not inherited:
        if context is not None:
            context.clear()
        return [], 0, False
    bands = horizontal_bands(headers, width) if headers else [(band['left'], band['right']) for band in inherited]
    if headers and len(bands) == 1 and any(FINISH_MRPS <= {column.key for column in header} for header in headers):
        code_left = min(column.left for header in headers for column in header if column.key == 'code')
        if code_left >= width * .30:
            # Keep gallery captions out of the code column even when the
            # photo label shares a baseline with the corresponding table row.
            bands = [(code_left - 12, width)]
    rows = []
    next_bands = []
    for left, right in bands:
        block = [[box for box in line if left <= (box.x0 + box.x1) / 2 < right] for line in lines]
        previous = next((band for band in inherited if abs(left - band['left']) < 12
                         and abs(right - band['right']) < 12), {})
        found, state = parse_band([line for line in block if line], left, right, parse_price, previous)
        rows.extend(found)
        if found:
            next_bands.append({'left': left, 'right': right, **state})
    if context is not None:
        context.update(width=width, bands=next_bands)
    advanced = len(bands) > 1 or bool(inherited) or any(row.matrix or row.wrapped or row.series for row in rows) or any(
        column.key in {'size', 'size_cm', 'size_inch', 'turn', 'knob', 'pack', 'box', 'way', 'electrical_details',
                       'pole', 'wattage', 'finish', 'standard', 'image', 'combined_pack'} | FINISH_MRPS or column.length
        for header in headers for column in header
    ) or any(HSN.search(line_text(line)) for line in lines)
    return rows, len({(row.bounds[0], row.section) for row in rows}), advanced


CARD_PRICE = re.compile(
    r'(?P<price>(?:(?:MRP(?:\s*/\s*unit)?|list\s+price|LP|rate|price)\s*[:.=]?\s*'
    r'(?:₹|Rs\.?|INR)?\s*|(?:₹|Rs\.?|INR)\s*)\d[\d,]*(?:\.\d+)?(?:\s*/\s*-)?'
    r'|\d[\d,]*(?:\.\d+)?\s*/\s*-)\s*$', re.I,
)
CARD_CODE = re.compile(
    r'\b(?:cat(?:alogue)?\.?\s*(?:no\.?|number)|(?:item|part|product|model)\s*(?:code|no\.?|number)'
    r'|ref\.?\s*no\.?|SKU|code)\s*[:.#-]?\s*(?P<sku>[A-Za-z0-9][A-Za-z0-9./_-]*)\s*$', re.I,
)


def brochure_rows(boxes, width, parse_price, photo_bounds):
    """Read repeated, independently priced product cards without crossing columns."""
    segments = []
    for line in lines_of(boxes):
        chunk = []
        for box in line:
            if chunk and box.x0 - chunk[-1].x1 > max(20, 2 * (box.bottom - box.top)):
                segments.append(chunk)
                chunk = []
            chunk.append(box)
        if chunk:
            segments.append(chunk)

    prices = []
    for line in segments:
        if match := CARD_PRICE.search(line_text(line)):
            amount = parse_price(match['price'])
            if amount is not None:
                prices.append((line, amount, match.start()))
    if len(prices) < 2:
        return []

    def centers(positions):
        columns = []
        for position in sorted(positions):
            if not columns or position - columns[-1][0] > width * .08:
                columns.append([])
            columns[-1].append(position)
        return [sum(column) / len(column) for column in columns]

    price_centers = centers(line[0].x0 for line, _, _ in prices)
    image_centers = centers((left + right) / 2 for left, _, right, _ in photo_bounds)
    anchors = image_centers if 2 <= len(image_centers) == len(price_centers) <= 4 else price_centers
    if not 2 <= len(anchors) <= 4:
        return []
    if anchors == price_centers:
        # Printed prices are often left-aligned with the captions.
        padding = min(width * .05, anchors[0])
        boundaries = [0, *(anchor - padding for anchor in anchors[1:]), width]
    else:
        boundaries = [0, *((left + right) / 2 for left, right in zip(anchors, anchors[1:])), width]
    rows = []
    for left, right in zip(boundaries, boundaries[1:]):
        band = [line for line in segments if left <= line[0].x0 < right and line[-1].x1 <= right + 2]
        previous_bottom = 0
        for line, amount, price_start in sorted(prices, key=lambda entry: entry[0][0].center):
            if line not in band:
                continue
            bottom = max(box.bottom for box in line)
            top = max(previous_bottom, bottom - 180)
            previous_bottom = bottom
            nearby = [line_text(part) for part in band if top < part[0].center < line[0].center]
            if price_start:
                nearby.append(line_text(line)[:price_start].rstrip(' |:–-'))
            identified = []
            for index, text in enumerate(nearby):
                match = CARD_CODE.search(text)
                raw = code_value(match['sku'] if match else text)
                if not SKU.fullmatch(raw) or DIMENSION.fullmatch(raw):
                    continue
                if match or (len(raw) >= 4 and any(character.isalpha() for character in raw)):
                    identified.append((index, raw, text[:match.start()].strip(' |:–-') if match else ''))
            if len(identified) != 1:
                continue
            code_index, code, prefix = identified[0]
            nearby[code_index] = prefix
            name = ' '.join(text for text in nearby[-6:] if text and not NOISE.match(text)
                            and not HSN.match(text) and any(character.isalpha() for character in text))
            if not name or not any(character.isalpha() for character in name):
                continue
            rows.append(LayoutRow({'name': name}, code, amount, '', '', '', '',
                                  (left, top, right, bottom), len(rows)))
    # A single incidental match is not evidence of a repeating card layout.
    return rows if len(rows) >= 2 else []


def skip_reason(boxes):
    lines = lines_of(boxes)
    titles = [line_text(line) for line in lines[:6]]
    if any(CONTENTS.fullmatch(title) for title in titles):
        return 'table_of_contents'
    if any(ON_REQUEST.match(title) for title in titles) and not any(header_groups(line) for line in lines):
        return 'prices_on_request'
    return ''
