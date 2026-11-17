import re

from django.db.models import F, Q

from .taxonomy import SUB_CATEGORIES

WIRES = 'Wires & Industrial Cables'
SWITCHGEAR = 'Modular Switchgear & Distribution'
LIGHTING = 'Commercial & Industrial Lighting'
PIPING = 'Conduits, Piping & Installation Accessories'
SUB_BUSINESS_CATEGORIES = {
    'WIRES_CABLES': WIRES,
    'SWITCHES_SOCKETS': SWITCHGEAR,
    'MCB_DISTRIBUTION': SWITCHGEAR,
    'LIGHTING': LIGHTING,
    'CONDUITS_PIPES': PIPING,
    'PIPES_FITTINGS': PIPING,
}
SERIES = ('roma', 'roma urban', 'ziva', 'zen', 'penta modular', 'infinity', 'e square')
PLACEHOLDERS = ('uncategorized', 'uncategorised', 'untagged', 'unassigned')
LEGACY_CATEGORY_PATTERN = r'^\s*(?:' + '|'.join(
    name.replace(' ', r'[\s_-]+') for name in (*SERIES, *PLACEHOLDERS)
) + r')?\s*$'


def untagged_products():
    return (
        Q(brand_category__category__name__iregex=LEGACY_CATEGORY_PATTERN)
        | Q(brand_category__brand__name__iregex=r'^\s*$')
        | Q(brand_category__category__name__iexact=F('brand_category__brand__name'))
    )


def category_filter(query, value):
    if value == 'uncategorized':
        return query.filter(untagged_products())
    return query.filter(brand_category__category_id=value)


def normalized_name(value):
    return ' '.join(re.findall(r'[a-z0-9]+', value.casefold()))


def is_legacy_category(name, brand_name=''):
    key = normalized_name(name)
    return not key or key in (*SERIES, *PLACEHOLDERS) or key == normalized_name(brand_name)


def category_hint(*, document=None, hsn='', name=''):
    if (document and document.sub_category in SUB_CATEGORIES.get(document.business_type, ())
            and document.sub_category in SUB_BUSINESS_CATEGORIES):
        return SUB_BUSINESS_CATEGORIES[document.sub_category]
    for prefix, category in (('8536', SWITCHGEAR), ('8537', SWITCHGEAR), ('3917', PIPING),
                             ('8544', WIRES), ('9405', LIGHTING)):
        if str(hsn).strip().startswith(prefix):
            return category
    text = normalized_name(name)
    matches = {
        category for pattern, category in (
            (r'\b(switch(?:es)?|socket[s]?|mcb|rccb|switchgear)\b', SWITCHGEAR),
            (r'\b(pipe[s]?|conduit[s]?|cpvc|upvc)\b', PIPING),
            (r'\b(cable[s]?|wire[s]?)\b', WIRES),
            (r'\b(lighting|luminaire[s]?|downlight[s]?|floodlight[s]?)\b', LIGHTING),
        ) if re.search(pattern, text)
    }
    return next(iter(matches)) if len(matches) == 1 else None
