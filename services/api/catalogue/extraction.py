from functools import partial
from io import BytesIO
from pathlib import PurePath
import re

from PIL import Image, ImageOps
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.timezone import now
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from companies.permissions import HasStaffPermission
from .items import ItemInput, create_catalogue_item, eligible_associations
from .media import storage, validate_image
from .models import CatalogueDocument, DraftCatalogueItem


def document_associations(document):
    eligible = eligible_associations()
    brand = document.brand_name.strip()
    exact = eligible.filter(brand__name__iexact=brand)
    if brand.casefold() == 'anchor' and not exact.exists():
        return eligible.filter(brand__name__iexact='Anchor by Panasonic')
    return exact


def document_family_prefix(document):
    def normalize(value):
        return ' '.join(re.sub(r'[_-]+', ' ', value).split()).upper()

    # Vault storage uses the document UUID. The filename field retains the upload name.
    basename = PurePath((document.filename or document.file.name or '').replace('\\', '/')).name.strip()
    stem = basename[:-4] if basename.lower().endswith('.pdf') else PurePath(basename).stem
    if not document.filename and stem == str(document.key):
        stem = ''
    return normalize(stem) or normalize(document.title)


def normalize_item_name(raw_name: str | None, family_hint: str = '') -> tuple[str, str | None]:
    from .services.pdf_item_extractor import normalize_item_name as format_item_name, strip_leading_category_banner

    name, banner = strip_leading_category_banner(' '.join((raw_name or '').split()))
    possible_family, _, remainder = name.partition(' ')
    if not family_hint and possible_family.isalnum():
        description, embedded_banner = strip_leading_category_banner(remainder)
        if embedded_banner:
            name = description
            banner = banner or embedded_banner
            family_hint = family_hint.strip() or possible_family
    name, embedded_banner = format_item_name(name, family_hint, canonical_family=bool(family_hint))
    return name, banner or embedded_banner or None


class DraftOutput(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    def get_image_url(self, item):
        if not item.image:
            return None
        path = reverse('catalogue-draft-image', kwargs={'key': item.source_document.key, 'pk': item.pk})
        return f'{path}?v={PurePath(item.image.name).stem}'

    class Meta:
        model = DraftCatalogueItem
        fields = ['id', 'page', 'name', 'product_code', 'hsn_sac_code', 'price_per_unit', 'category',
                  'pack_size', 'status', 'product', 'image_url']


class ReviewRow(serializers.Serializer):
    id = serializers.IntegerField(min_value=1)
    approved = serializers.BooleanField()
    name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    product_code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    hsn_sac_code = serializers.CharField(max_length=8, required=False, allow_blank=True)
    price_per_unit = serializers.CharField(max_length=24, required=False, allow_blank=True)
    brand_category = serializers.IntegerField(min_value=1, required=False)


class ReviewInput(serializers.Serializer):
    rows = ReviewRow(many=True, min_length=1, max_length=500)

    def validate_rows(self, rows):
        if len({row['id'] for row in rows}) != len(rows):
            raise serializers.ValidationError('Each draft can appear only once.')
        return rows


class ExtractionInput(serializers.Serializer):
    start_page = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    end_page = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    append = serializers.BooleanField(default=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            return super().to_internal_value(data)
        data = data.copy()
        for field in ('start_page', 'end_page'):
            if isinstance(data.get(field), str) and not data[field].strip():
                data[field] = None
        return super().to_internal_value(data)

    def validate(self, attrs):
        start = attrs.get('start_page') or 1
        end = attrs.get('end_page')
        if end is not None and end < start:
            raise serializers.ValidationError({'end_page': 'The end page must be at or after the start page.'})
        return {'start_page': start, 'end_page': end, 'append': attrs['append']}


class StaffExtraction(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response

    def get(self, request, key):
        document = get_object_or_404(CatalogueDocument, key=key, is_active=True, content_type='application/pdf')
        return self.review(document, DraftOutput(document.draft_items.order_by('id'), many=True).data)

    def post(self, request, key):
        document = get_object_or_404(CatalogueDocument, key=key, is_active=True, content_type='application/pdf')
        serializer = ExtractionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        batch = serializer.validated_data
        progress = {}
        diagnostics = {'start_page': batch['start_page'], 'end_page': batch['end_page']}
        try:
            from .services.pdf_item_extractor import MAX_CATALOGUE_PDF_BYTES, MAX_ROWS, CataloguePDFError, extract_items
        except ImportError:
            self.record_failure(document, diagnostics, 'PDF extraction dependencies are unavailable.')
            return Response({'detail': 'PDF extraction dependencies are unavailable.'}, status=503)
        try:
            with document.file.open('rb') as source:
                family_hint = document_family_prefix(document)
                candidates = extract_items(source.read(MAX_CATALOGUE_PDF_BYTES + 1), family_hint=family_hint,
                                           start_page=batch['start_page'], end_page=batch['end_page'],
                                           progress=progress, diagnostics=diagnostics)
        except FileNotFoundError:
            self.record_failure(document, diagnostics, 'The source PDF file is missing.')
            return Response({'detail': 'The source PDF file is missing.'}, status=404)
        except CataloguePDFError as error:
            self.record_failure(document, diagnostics, str(error))
            raise serializers.ValidationError({'file': str(error)}) from error

        saved = []
        added = 0
        try:
            with transaction.atomic():
                document = get_object_or_404(CatalogueDocument.objects.select_for_update(), pk=document.pk, is_active=True)
                drafts = document.draft_items.filter(status=DraftCatalogueItem.Status.DRAFT)
                reviewed = set(document.draft_items.exclude(status=DraftCatalogueItem.Status.DRAFT)
                               .values_list('page', 'product_code'))
                image_storage = DraftCatalogueItem._meta.get_field('image').storage
                existing = set()
                draft_count = 0
                append = batch['append'] or not candidates or (
                    progress and progress['processed_through'] < progress['end_page']
                )
                if append:
                    pairs = list(drafts.values_list('product_code', 'name'))
                    existing = set(pairs)
                    draft_count = len(pairs)
                else:
                    for image in drafts.exclude(image='').values_list('image', flat=True):
                        transaction.on_commit(partial(image_storage.delete, image), robust=True)
                    drafts.delete()
                for candidate in candidates:
                    if (candidate.page, candidate.product_code) in reviewed:
                        continue
                    clean_name, banner = normalize_item_name(candidate.name, family_hint)
                    if not clean_name:
                        continue
                    pair = (candidate.product_code, clean_name)
                    if append and pair in existing:
                        continue
                    if draft_count >= MAX_ROWS:
                        raise serializers.ValidationError({'file': f'This catalogue can hold up to {MAX_ROWS} pending drafts. Publish or discard drafts before adding another batch.'})
                    existing.add(pair)
                    draft_count += 1
                    item = DraftCatalogueItem(source_document=document, page=candidate.page,
                        name=clean_name, product_code=candidate.product_code, hsn_sac_code=candidate.hsn_sac_code,
                        price_per_unit=candidate.price_per_unit, category=candidate.category or banner or '',
                        pack_size=candidate.pack_size)
                    if candidate.image:
                        item.image.save('thumbnail.png', ContentFile(candidate.image), save=False)
                        saved.append(item.image)
                    item.save()
                    added += 1
                rows = DraftOutput(document.draft_items.order_by('id'), many=True).data
                document.last_extraction = {**diagnostics, **progress, 'added': added,
                                            'status': 'partial' if progress and progress['processed_through'] < progress['end_page']
                                            else ('complete' if candidates else 'no_items'),
                                            'finished_at': now().isoformat()}
                document.save(update_fields=['last_extraction'])
        except Exception as error:
            for image in saved:
                image.delete(save=False)
            message = error.detail.get('file') if isinstance(error, serializers.ValidationError) and isinstance(error.detail, dict) else None
            self.record_failure(document, diagnostics, str(message or 'The extraction results could not be saved. Existing drafts were retained.'))
            raise
        return self.review(document, rows, batch={**progress, 'added': added} if progress else None)

    def review(self, document, rows, batch=None):
        options = document_associations(document).values(
            'id', 'category__name', 'brand__company__legal_name').order_by('category__name', 'id')
        return Response({'rows': rows, 'categories': list(options), 'diagnostics': document.last_extraction,
                         **({'batch': batch} if batch else {})})

    @staticmethod
    def record_failure(document, diagnostics, message):
        CatalogueDocument.objects.filter(pk=document.pk).update(
            last_extraction={**diagnostics, 'status': 'failed', 'error': message, 'finished_at': now().isoformat()})


class DraftImage(StaffExtraction):
    http_method_names = ['get', 'head', 'post', 'delete', 'options']
    parser_classes = [MultiPartParser]

    def get(self, request, key, pk):
        item = get_object_or_404(DraftCatalogueItem, source_document__key=key, pk=pk)
        if not item.image:
            return Response(status=404)
        try:
            image = item.image.open('rb')
        except FileNotFoundError:
            return Response(status=404)
        return FileResponse(image, content_type='image/png', headers={'X-Content-Type-Options': 'nosniff'})

    def post(self, request, key, pk):
        upload = request.FILES.get('image')
        if not upload or not upload.size:
            raise serializers.ValidationError({'image': 'Choose a non-empty JPEG, PNG or WebP image.'})
        if upload.size > 5 * 1024 * 1024:
            raise serializers.ValidationError({'image': 'Image must be 5 MB or smaller.'})
        validate_image(upload, upload.content_type)
        upload.seek(0)
        with Image.open(upload) as original:
            photo = ImageOps.exif_transpose(original).convert('RGBA')
            photo.thumbnail((640, 640), Image.Resampling.LANCZOS)
            photo.info.clear()
            output = BytesIO()
            photo.save(output, format='PNG')
        return self.update_image(key, pk, ContentFile(output.getvalue()))

    def delete(self, request, key, pk):
        return self.update_image(key, pk, None)

    def update_image(self, key, pk, content):
        saved = None
        try:
            with transaction.atomic():
                document = get_object_or_404(CatalogueDocument.objects.select_for_update(), key=key, is_active=True)
                item = get_object_or_404(document.draft_items, pk=pk)
                if item.status != DraftCatalogueItem.Status.DRAFT:
                    return Response({'detail': 'Only unreviewed drafts can change photos.'}, status=409)
                previous = item.image.name
                image_storage = item.image.storage
                if content is None:
                    item.image = ''
                else:
                    item.image.save('photo.png', content, save=False)
                    saved = item.image
                item.save(update_fields=['image'])
                if previous:
                    transaction.on_commit(partial(image_storage.delete, previous), robust=True)
                data = DraftOutput(item).data
        except Exception:
            if saved:
                saved.delete(save=False)
            raise
        return Response(data)


class CommitDrafts(StaffExtraction):
    http_method_names = ['post', 'options']

    def post(self, request, key):
        input_data = ReviewInput(data=request.data)
        input_data.is_valid(raise_exception=True)
        rows = input_data.validated_data['rows']
        saved = []
        created = []
        try:
            with transaction.atomic():
                document = get_object_or_404(CatalogueDocument.objects.select_for_update(), key=key, is_active=True)
                associations = document_associations(document)
                drafts = document.draft_items.in_bulk([row['id'] for row in rows])
                if len(drafts) != len(rows) or any(item.status != DraftCatalogueItem.Status.DRAFT for item in drafts.values()):
                    return Response({'detail': 'One or more drafts have already been reviewed or belong to another PDF.'}, status=409)
                # Take code locks in a consistent order across simultaneous imports.
                for row in sorted(rows, key=lambda row: (row.get('product_code', ''), row['id'])):
                    draft = drafts[row['id']]
                    if not row['approved']:
                        draft.status = DraftCatalogueItem.Status.DISCARDED
                        draft.save(update_fields=['status'])
                        continue
                    fields = {field: row[field] for field in (
                        'name', 'product_code', 'hsn_sac_code', 'price_per_unit', 'brand_category',
                    ) if field in row}
                    if draft.image:
                        try:
                            with draft.image.open('rb') as image:
                                fields['image'] = SimpleUploadedFile(PurePath(draft.image.name).name, image.read(), 'image/png')
                        except FileNotFoundError:
                            raise serializers.ValidationError({'rows': f'Page {draft.page}, {draft.product_code}: the draft image is missing.'})
                    item = ItemInput(data=fields)
                    if not item.is_valid():
                        raise serializers.ValidationError({'rows': {str(draft.id): item.errors}})
                    values = item.validated_data
                    association = values['brand_category']
                    if not associations.filter(pk=association.pk).exists():
                        raise serializers.ValidationError({'rows': f'{draft.product_code}: choose a category for the PDF brand.'})
                    product, result = create_catalogue_item(request, values, saved, pack_size=draft.pack_size)
                    draft.name = product.name
                    draft.product_code = product.code
                    draft.hsn_sac_code = values['hsn_sac_code']
                    draft.price_per_unit = product.catalogue_price
                    draft.category = association.category.name
                    draft.product = product
                    draft.status = DraftCatalogueItem.Status.APPROVED
                    draft.save()
                    created.append(result)
        except Exception as error:
            for name in saved:
                storage().delete(name)
            if isinstance(error, IntegrityError):
                raise serializers.ValidationError({'rows': 'A product code or category conflicts with the active catalogue.'}) from error
            raise
        return Response({'items': created, 'discarded': sum(not row['approved'] for row in rows)}, status=201)
