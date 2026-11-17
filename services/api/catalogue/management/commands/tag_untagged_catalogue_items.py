from django.core.management.base import BaseCommand
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError

from catalogue.models import Brand, BrandCategory, Category, Product
from catalogue.tagging import category_hint, is_legacy_category, normalized_name, untagged_products


class Command(BaseCommand):
    help = 'Preview or repair legacy catalogue categories without changing product brand ownership.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--dry-run', action='store_true')
        mode.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        apply = options['apply']
        targets = {}
        for category in Category.objects.filter(active=True):
            targets.setdefault(normalized_name(category.name), []).append(category)
        products = Product.objects.filter(untagged_products()).select_related(
            'brand_category__brand', 'brand_category__category', 'draftcatalogueitem__source_document',
        ).defer('draftcatalogueitem__pack_size', 'draftcatalogueitem__source_document__last_extraction').order_by('pk')
        if apply:
            products = products.select_for_update(of=('self',))
        changed = unresolved = 0
        planned = set()
        moving_ids = []
        for item in products.iterator():
            link = item.brand_category
            draft = getattr(item, 'draftcatalogueitem', None)
            document = draft.source_document if draft else None
            brand = normalized_name(link.brand.name)
            if document and normalized_name(document.brand_name) not in (
                brand, 'anchor' if brand == 'anchor by panasonic' else brand,
            ):
                document = None
            specifications = item.specifications if isinstance(item.specifications, dict) else {}
            hsn = next((value for key, value in specifications.items() if normalized_name(key) in ('hsn', 'hsn sac', 'hsn code')), '')
            hint = category_hint(document=document, hsn=hsn, name=item.name)
            categories = targets.get(normalized_name(hint or ''), [])
            if not link.brand.name.strip() or len(categories) != 1:
                self.stdout.write(f'Skipped product {item.pk} ({item.code}): missing brand or no unambiguous active category.')
                unresolved += 1
                continue
            target = categories[0]
            key = (link.brand_id, target.pk, item.code)
            if key in planned or Product.objects.filter(
                brand_category__brand=link.brand, brand_category__category=target, code=item.code,
            ).exclude(pk=item.pk).exists():
                self.stdout.write(f'Skipped product {item.pk} ({item.code}): code conflicts in the target category.')
                unresolved += 1
                continue
            if apply:
                try:
                    with transaction.atomic():
                        association, _ = BrandCategory.objects.get_or_create(brand=link.brand, category=target)
                        item.brand_category = association
                        item.save(update_fields=['brand_category', 'updated_at'])
                except IntegrityError:
                    self.stdout.write(f'Skipped product {item.pk} ({item.code}): the catalogue changed during tagging.')
                    unresolved += 1
                    continue
            planned.add(key)
            moving_ids.append(item.pk)
            changed += 1
            self.stdout.write(f'{"Tagged" if apply else "Would tag"} product {item.pk} ({item.code}) as {target.name} under {link.brand.name}.')
        removed = 0
        brand_names = {normalized_name(name) for name in Brand.objects.values_list('name', flat=True)}
        for category in Category.objects.order_by('pk'):
            if not (is_legacy_category(category.name) or normalized_name(category.name) in brand_names):
                continue
            links = BrandCategory.objects.filter(category=category)
            if Product.objects.filter(brand_category__category=category).exclude(pk__in=moving_ids).exists():
                continue
            if category.catalogueaudit_set.exists():
                continue
            if apply:
                try:
                    with transaction.atomic():
                        links.delete()
                        category.delete()
                except ProtectedError:
                    continue
            removed += 1
            self.stdout.write(f'{"Removed" if apply else "Would remove"} orphaned category {category.name!r}.')
        self.stdout.write(f'{"Applied" if apply else "Dry run"}: {changed} tagged, {unresolved} skipped, {removed} orphaned categories.')
