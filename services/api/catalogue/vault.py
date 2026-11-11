from pathlib import PurePath

from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from rest_framework import serializers
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from companies.permissions import HasStaffPermission
from .media import IMAGE_TYPES, validate_file
from .models import CatalogueDocument, ProductMedia
from .taxonomy import ALL_SUB_CATEGORIES, CATALOGUE_BUSINESS_KEYS, SUB_CATEGORIES
from .views import Pages


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
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return documents(request)


class PublicCatalogueFile(PublicCatalogueVault):
    def get(self, request, key):
        return serve(get_object_or_404(CatalogueDocument, key=key, is_active=True))


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
                item.save()
        except Exception:
            if item.file._committed:
                item.file.delete(save=False)
            raise
        return Response(DocumentMetadata(item, context={'staff': True}).data, status=201)


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
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        if serializer.validated_data:
            item.save(update_fields=serializer.validated_data.keys())
        return Response(DocumentMetadata(item, context={'staff': True}).data)

    def delete(self, request, key):
        item = get_object_or_404(CatalogueDocument, key=key)
        CatalogueDocument.objects.filter(pk=item.pk).update(is_active=False)
        return Response(status=204)


class StaffCatalogueFile(StaffCatalogueVault):
    http_method_names = ['get', 'head', 'options']

    def get(self, request, key):
        return serve(get_object_or_404(CatalogueDocument, key=key))
