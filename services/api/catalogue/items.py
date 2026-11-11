from decimal import Decimal
from uuid import uuid4

from django.db import IntegrityError, connection, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from companies.permissions import HasStaffPermission
from .media import attachment, media_url, storage, validate_file
from .models import BrandCategory, Product, ProductMedia
from .views import Pages, audit, eligible_products, products


def item_hsn(product):
    return str(product.specifications.get('HSN', ''))[:8]


class ItemOutput(serializers.ModelSerializer):
    product_code = serializers.CharField(source='code')
    price_per_unit = serializers.DecimalField(source='catalogue_price', max_digits=18, decimal_places=4)
    hsn_sac_code = serializers.SerializerMethodField()
    brand_name = serializers.CharField(source='brand_category.brand.name')
    brand_id = serializers.IntegerField(source='brand_category.brand_id')
    category_name = serializers.CharField(source='brand_category.category.name')
    image_url = serializers.SerializerMethodField()

    def get_hsn_sac_code(self, product):
        return item_hsn(product)

    def get_image_url(self, product):
        return media_url(self.context['request'], attachment(product, ProductMedia.Kind.IMAGE))

    class Meta:
        model = Product
        fields = ['id', 'name', 'product_code', 'price_per_unit', 'hsn_sac_code', 'brand_id',
                  'brand_category', 'brand_name', 'category_name', 'image_url']


def eligible_associations():
    return BrandCategory.objects.filter(category__active=True, brand__company__verification_state='VERIFIED',
        brand__company__activity_state='ACTIVE', brand__company__owner_account__access_state='ACTIVE')


class ItemInput(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    product_code = serializers.CharField(max_length=100)
    hsn_sac_code = serializers.RegexField(r'^[0-9]{4,8}$')
    price_per_unit = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal('0'))
    brand_category = serializers.PrimaryKeyRelatedField(queryset=BrandCategory.objects.none())
    image = serializers.FileField(required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['brand_category'].queryset = eligible_associations()

    def validate_image(self, upload):
        validate_file(upload, ProductMedia.Kind.IMAGE)
        return upload


def require_available_code(code, *, exclude=None):
    if connection.vendor == 'postgresql':
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(46123802, hashtext(%s))', [code])
    if Product.objects.filter(code=code).exclude(pk=exclude).exists():
        raise serializers.ValidationError({'product_code': 'This product code is already in use.'})


class CatalogueItems(APIView):
    parser_classes = [MultiPartParser]
    required_staff_permission = 'MODERATE_PRODUCTS'

    def get_permissions(self):
        return [AllowAny()] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else [HasStaffPermission()]

    def get(self, request):
        query = products().filter(pk__in=eligible_products().values('pk'), catalogue_price__isnull=False)
        paginator = Pages()
        items = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response(ItemOutput(items, many=True, context={'request': request}).data)

    def post(self, request):
        serializer = ItemInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        upload = fields.get('image')
        saved_name = None
        try:
            with transaction.atomic():
                require_available_code(fields['product_code'])
                product = Product.objects.create(
                    brand_category=fields['brand_category'], name=fields['name'], code=fields['product_code'],
                    specifications={'HSN': fields['hsn_sac_code']}, unit='Unit',
                    catalogue_price=fields['price_per_unit'], currency='INR', state='PUBLISHED',
                )
                if upload:
                    media = ProductMedia.objects.create(product=product, kind=ProductMedia.Kind.IMAGE,
                        key=uuid4(), filename=upload.name, content_type=upload.content_type, size=upload.size)
                    saved_name = storage().save(media.storage_name, upload)
                    if saved_name != media.storage_name:
                        raise OSError('Could not allocate catalogue image storage.')
                result = ItemOutput(product, context={'request': request}).data
                audit(request, 'PRODUCT_CREATED', product, result)
        except Exception as error:
            if saved_name:
                storage().delete(saved_name)
            if isinstance(error, IntegrityError):
                raise serializers.ValidationError({'product_code': 'Duplicate code or an ineligible brand/category.'}) from error
            raise
        return Response(result, status=201)


class CatalogueItemDetail(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'
    parser_classes = [JSONParser, MultiPartParser]

    def patch(self, request, pk):
        serializer = ItemInput(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        upload = fields.get('image')
        saved_name = None
        files = storage()
        try:
            with transaction.atomic():
                item = get_object_or_404(eligible_products().select_for_update(of=('self',)), pk=pk,
                                         catalogue_price__isnull=False)
                association = fields.get('brand_category')
                if association and association.brand_id != item.brand_category.brand_id:
                    raise serializers.ValidationError({'brand_category': 'Choose a category for the current brand.'})
                if 'product_code' in fields and fields['product_code'] != item.code:
                    require_available_code(fields['product_code'], exclude=item.pk)
                for source, target in [('name', 'name'), ('product_code', 'code'),
                                       ('price_per_unit', 'catalogue_price'), ('brand_category', 'brand_category')]:
                    if source in fields:
                        setattr(item, target, fields[source])
                if 'hsn_sac_code' in fields:
                    item.specifications = {**item.specifications, 'HSN': fields['hsn_sac_code']}
                if set(fields) - {'image'}:
                    item.save()
                if upload:
                    previous = ProductMedia.objects.filter(product=item, kind=ProductMedia.Kind.IMAGE).first()
                    media, _ = ProductMedia.objects.update_or_create(product=item, kind=ProductMedia.Kind.IMAGE,
                        defaults={'key': uuid4(), 'filename': upload.name, 'content_type': upload.content_type, 'size': upload.size})
                    saved_name = files.save(media.storage_name, upload)
                    if saved_name != media.storage_name:
                        raise OSError('Could not allocate catalogue image storage.')
                    if previous:
                        transaction.on_commit(lambda: files.delete(previous.storage_name), robust=True)
                result = ItemOutput(item, context={'request': request}).data
                audit(request, 'PRODUCT_UPDATED', item, result)
        except Exception as error:
            if saved_name:
                files.delete(saved_name)
            if isinstance(error, IntegrityError):
                raise serializers.ValidationError({'product_code': 'Duplicate code or an ineligible category.'}) from error
            raise
        return Response(result)

    @transaction.atomic
    def delete(self, request, pk):
        item = get_object_or_404(Product.objects.select_for_update(), pk=pk, catalogue_price__isnull=False)
        if item.state != 'ARCHIVED':
            if not eligible_products().filter(pk=pk).exists():
                return Response({'detail': 'This item is already unavailable in dealer discovery.'}, status=409)
            item.state = 'ARCHIVED'
            item.save(update_fields=['state', 'updated_at'])
            audit(request, 'PRODUCT_ARCHIVED', item, {'state': item.state})
        return Response(status=204)


class ItemOptions(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'

    def get(self, request):
        links = eligible_associations().values('id', 'brand_id', 'brand__name', 'category__name').order_by('brand__name', 'category__name', 'pk')
        return Response(list(links))
