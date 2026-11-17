from django.db.models import Case, Exists, OuterRef, Q, When

from .models import ProductVariant


def product_terms(term, prefix=''):
    fields = (
        'name', 'code', 'description', 'specifications',
        'brand_category__brand__name', 'brand_category__category__name',
        'draftcatalogueitem__source_document__sub_category',
    )
    match = Q()
    for field in fields:
        match |= Q(**{f'{prefix}{field}__icontains': term})
    return match


def search_products(query, search, *, ranked=False):
    terms = search.split()
    if not terms:
        return query
    phrase = ' '.join(terms)
    code_match = Q(code__icontains=phrase)
    name_match = Q()
    all_terms = Q()
    for term in terms:
        name_match &= Q(name__icontains=term)
        variants = ProductVariant.objects.filter(product_id=OuterRef('pk'), active=True).filter(
            Q(sku__icontains=term) | Q(name__icontains=term) | Q(attributes__icontains=term),
        )
        all_terms &= product_terms(term) | Q(Exists(variants))
    query = query.filter(code_match | all_terms)
    if ranked:
        query = query.alias(search_rank=Case(
            When(code__iexact=phrase, then=0),
            When(code__istartswith=phrase, then=1),
            When(code_match, then=2),
            When(name_match & Q(name__istartswith=terms[0]), then=3),
            When(name_match, then=4),
            default=5,
        )).order_by('search_rank', 'pk')
    return query
