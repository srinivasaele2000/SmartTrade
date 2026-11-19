from functools import partial
from pathlib import PurePath
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from rest_framework import serializers
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from companies.permissions import HasStaffPermission
from .brands import BrandProvisioningBlocked, brand_metadata, get_or_provision_verified_brand
from .media import IMAGE_TYPES, validate_file
from .models import CatalogueDocument, DraftCatalogueItem, ProductMedia
from .taxonomy import ALL_SUB_CATEGORIES, CATALOGUE_BUSINESS_KEYS, SUB_CATEGORIES
from .views import Pages, audit


class DocumentMetadata(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    def get_download_url(self, item):
        route = 'vault-staff-file' if self.context.get('staff') else 'vault-public-file'
        return reverse(route, kwargs={'key': item.key})

    class Meta:
        model = CatalogueDocument
        fields = ['key', 'business_type', 'sub_category', 'brand_name', 'title', 'filename', 'content_type',
                  'file_size_bytes', 'created_at', 'is_active', 'download_url']


class DocumentEdit(serializers.ModelSerializer):
    class Meta:
        model = CatalogueDocument
        fields = ['business_type', 'sub_category', 'brand_name', 'title']

    def validate(self, attrs):
        business_type = attrs.get('business_type', getattr(self.instance, 'business_type', None))
        if self.instance and business_type != self.instance.business_type:
            attrs.setdefault('sub_category', '')
        sub_category = attrs.get('sub_category', getattr(self.instance, 'sub_category', ''))
        if sub_category and sub_category not in SUB_CATEGORIES.get(business_type, ()):
            raise serializers.ValidationError({'sub_category': 'Choose a sub-business for the selected business type.'})
        return attrs


class DocumentInput(DocumentEdit):
    file = serializers.FileField(max_length=255)

    class Meta(DocumentEdit.Meta):
        fields = [*DocumentEdit.Meta.fields, 'file']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        upload = attrs['file']
        kind = ProductMedia.Kind.IMAGE if upload.content_type in IMAGE_TYPES else ProductMedia.Kind.PDF
        validate_file(upload, kind)
        # Use a verified canonical suffix for the stored path.
        suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf'}
        attrs['filename'] = PurePath(upload.name).stem[:251] + suffix[upload.content_type]
        attrs['content_type'] = upload.content_type
        attrs['file_size_bytes'] = upload.size
        upload.name = attrs['filename']
        return attrs


def documents(request, *, staff=False):
    query = CatalogueDocument.objects.order_by('-pk')
    if not staff:
        query = query.filter(is_active=True)
    business_type = request.query_params.get('business_type')
    if business_type is not None:
        if business_type not in CATALOGUE_BUSINESS_KEYS:
            raise serializers.ValidationError({'business_type': 'Choose a supported business type.'})
        query = query.filter(business_type=business_type)
    sub_category = request.query_params.get('sub_category')
    if sub_category:
        allowed = ALL_SUB_CATEGORIES if business_type is None else SUB_CATEGORIES.get(business_type, ())
        if sub_category not in allowed:
            raise serializers.ValidationError({'sub_category': 'Choose a supported sub-business for this filter.'})
        query = query.filter(sub_category=sub_category)
    for term in request.query_params.get('search', '').split():
        query = query.filter(Q(title__icontains=term) | Q(brand_name__icontains=term) | Q(filename__icontains=term))
    paginator = Pages()
    return paginator.get_paginated_response(DocumentMetadata(
        paginator.paginate_queryset(query, request), many=True, context={'staff': staff},
    ).data)


def serve(item):
    try:
        stream = item.file.open('rb')
    except FileNotFoundError:
        raise Http404
    response = FileResponse(stream, as_attachment=True, filename=item.filename, content_type=item.content_type)
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'no-store'
    return response


class PublicCatalogueVault(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return documents(request)


class PublicCatalogueFile(PublicCatalogueVault):
    def get(self, request, key):
        return serve(get_object_or_404(CatalogueDocument, key=key, is_active=True))


def provision_pdf_brand(item, actor):
    try:
        return get_or_provision_verified_brand(item.brand_name, actor=actor)
    except BrandProvisioningBlocked:
        # Keep the PDF available for manual resolution in the extraction drawer.
        return None


class BrandProvisionInput(serializers.Serializer):
    brand_name = serializers.CharField(max_length=160)
    company_name = serializers.CharField(max_length=200, required=False)
    document_id = serializers.CharField(max_length=36, required=False)

    def validate_document_id(self, value):
        try:
            if value.isascii() and value.isdecimal() and 0 < int(value) < 2**63:
                return {'pk': int(value)}
            return {'key': UUID(value)}
        except ValueError as exc:
            raise serializers.ValidationError('Enter a valid catalogue document ID.') from exc


class StaffProvisionBrand(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'

    @transaction.atomic
    def post(self, request):
        payload = BrandProvisionInput(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        document = None
        if 'document_id' in values:
            document = get_object_or_404(CatalogueDocument.objects.select_for_update(), is_active=True,
                                         content_type='application/pdf', **values['document_id'])
        brand = get_or_provision_verified_brand(values['brand_name'], values.get('company_name'), actor=request.user)
        if document is not None:
            document.resolved_brand = brand
            document.brand_name = brand.name
            document.save(update_fields=['resolved_brand', 'brand_name'])
        return Response({'brand': brand_metadata(brand)})


class StaffCatalogueVault(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'
    parser_classes = [MultiPartParser]

    def get(self, request):
        return documents(request, staff=True)

    def post(self, request):
        serializer = DocumentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = CatalogueDocument(**serializer.validated_data)
        try:
            with transaction.atomic():
                if item.content_type == 'application/pdf':
                    item.resolved_brand = provision_pdf_brand(item, request.user)
                item.save()
        except Exception:
            if item.file._committed:
                item.file.delete(save=False)
            raise
        return Response({**DocumentMetadata(item, context={'staff': True}).data,
                         'brand_ready': bool(item.resolved_brand_id)}, status=201)


class StaffCatalogueDocument(StaffCatalogueVault):
    http_method_names = ['patch', 'delete', 'options']
    parser_classes = [JSONParser]

    @transaction.atomic
    def patch(self, request, key):
        item = get_object_or_404(CatalogueDocument.objects.select_for_update(), key=key)
        serializer = DocumentEdit(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        unsupported = set(request.data) - set(serializer.fields)
        if unsupported:
            raise serializers.ValidationError({field: 'This field cannot be edited.' for field in sorted(unsupported)})
        changes = serializer.validated_data.copy()
        if changes.get('brand_name', item.brand_name) != item.brand_name:
            changes['resolved_brand'] = None
        for field, value in changes.items():
            setattr(item, field, value)
        if changes and item.content_type == 'application/pdf' and not item.resolved_brand_id:
            item.resolved_brand = provision_pdf_brand(item, request.user)
            changes['resolved_brand'] = item.resolved_brand
        if changes:
            item.save(update_fields=changes.keys())
        return Response({**DocumentMetadata(item, context={'staff': True}).data,
                         'brand_ready': bool(item.resolved_brand_id)})

    def delete(self, request, key):
        item = get_object_or_404(CatalogueDocument, key=key)
        CatalogueDocument.objects.filter(pk=item.pk).update(is_active=False)
        return Response(status=204)


class StaffCatalogueFile(StaffCatalogueVault):
    http_method_names = ['get', 'head', 'options']

    def get(self, request, key):
        return serve(get_object_or_404(CatalogueDocument, key=key))


class DeleteCataloguePDF(StaffCatalogueVault):
    http_method_names = ['delete', 'options']

    @transaction.atomic
    def delete(self, request, key):
        # The commit and extraction paths use this same document lock.
        document = get_object_or_404(CatalogueDocument.objects.select_for_update(), key=key,
                                     content_type='application/pdf')
        drafts = document.draft_items.all()
        if drafts.filter(Q(status=DraftCatalogueItem.Status.APPROVED) | Q(product__isnull=False)).exists():
            return Response({'detail': 'This PDF is linked to published catalogue items. Archive it to remove it from public browsing.'},
                            status=409)

        image_storage = DraftCatalogueItem._meta.get_field('image').storage
        image_names = list(drafts.exclude(image='').values_list('image', flat=True))
        document_storage, document_name = document.file.storage, document.file.name
        count, _ = drafts.delete()
        audit(request, 'CATALOGUE_PDF_DELETED', document, {
            'key': str(document.key), 'title': document.title, 'filename': document.filename,
            'brand_name': document.brand_name, 'is_active': document.is_active, 'deleted_drafts': count,
        })
        document.delete()
        transaction.on_commit(partial(document_storage.delete, document_name), robust=True)
        for image_name in image_names:
            transaction.on_commit(partial(image_storage.delete, image_name), robust=True)
        return Response(status=204)
