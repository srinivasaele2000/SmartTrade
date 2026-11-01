from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from companies.models import CompanyProfile
from companies.permissions import HasStaffPermission, IsCompanyAccount
from .models import Brand, BrandCategory, CatalogueAudit, Category, Product, ProductVariant
from .serializers import BrandSerializer, BrandCategorySerializer, CategorySerializer, ProductSerializer, VariantSerializer


class Pages(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


def eligible_products():
    return Product.objects.filter(state='PUBLISHED', moderation_state='VISIBLE', brand_category__category__active=True, brand_category__brand__company__verification_state='VERIFIED', brand_category__brand__company__activity_state='ACTIVE', brand_category__brand__company__owner_account__access_state='ACTIVE')


def products():
    return Product.objects.select_related('brand_category__brand__company', 'brand_category__category').prefetch_related('variants').order_by('pk')


def owner(request):
    company = get_object_or_404(CompanyProfile.objects.select_for_update(), owner_account=request.user)
    if not company.can_publish_catalogue:
        raise PermissionDenied('A verified, active company and active account are required for catalogue writes.')
    return company


def audit(request, action, instance, snapshot, reason=''):
    values = dict(actor=request.user, action=action, snapshot=snapshot, reason=reason)
    if isinstance(instance, ProductVariant):
        values['variant'] = instance
        instance = instance.product
    if isinstance(instance, Product):
        values['product'] = instance
        instance = instance.brand_category.brand
    if isinstance(instance, BrandCategory):
        values['category'] = instance.category
        instance = instance.brand
    if isinstance(instance, Brand):
        values.update(brand=instance, company=instance.company)
    if isinstance(instance, Category):
        values['category'] = instance
    CatalogueAudit.objects.create(**values)


class PublicProducts(generics.ListAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = ProductSerializer
    pagination_class = Pages

    def get_serializer_context(self):
        return super().get_serializer_context() | {'public': True}

    def get_queryset(self):
        qs = products().filter(pk__in=eligible_products().values('pk'))
        for param, field in [('brand', 'brand_category__brand_id'), ('category', 'brand_category__category_id'), ('company', 'brand_category__brand__company_id')]:
            value = self.request.query_params.get(param)
            if value:
                if not value.isdecimal():
                    raise serializers.ValidationError({param: 'Expected a numeric ID.'})
                qs = qs.filter(**{field: value})
        search = self.request.query_params.get('search', '').strip()
        return qs.filter(name__icontains=search) if search else qs


class PublicProduct(generics.RetrieveAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = ProductSerializer

    def get_serializer_context(self):
        return super().get_serializer_context() | {'public': True}

    def get_queryset(self):
        return products().filter(pk__in=eligible_products().values('pk'))


class Categories(generics.ListAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    queryset = Category.objects.filter(active=True).order_by('name')
    serializer_class = CategorySerializer
    pagination_class = Pages


class StaffCategories(generics.ListCreateAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MANAGE_TAXONOMY'
    queryset = Category.objects.order_by('name')
    serializer_class = CategorySerializer
    pagination_class = Pages

    @transaction.atomic
    def perform_create(self, serializer):
        item = serializer.save()
        audit(self.request, 'CATEGORY_CREATED', item, serializer.data)


class OwnerCatalogue(APIView):
    permission_classes = [IsCompanyAccount]

    def get(self, request, resource):
        company = get_object_or_404(CompanyProfile, owner_account=request.user)
        options = {
            'brands': (Brand.objects.filter(company=company).select_related('company').prefetch_related('category_links__category').order_by('pk'), BrandSerializer),
            'brand-categories': (BrandCategory.objects.filter(brand__company=company).order_by('pk'), BrandCategorySerializer),
            'products': (products().filter(brand_category__brand__company=company), ProductSerializer),
        }
        qs, serializer = options[resource]
        if resource == 'products':
            search = request.query_params.get('search', '').strip()
            if search:
                qs = qs.filter(name__icontains=search)
            state = request.query_params.get('state')
            if state:
                if state not in ['DRAFT', 'PUBLISHED', 'ARCHIVED']:
                    raise serializers.ValidationError({'state': 'Invalid publication state.'})
                qs = qs.filter(state=state)
        pages = Pages()
        return pages.get_paginated_response(serializer(pages.paginate_queryset(qs, request), many=True).data)

    @transaction.atomic
    def post(self, request, resource):
        company = owner(request)
        serializer_type = {'brands': BrandSerializer, 'brand-categories': BrandCategorySerializer, 'products': ProductSerializer}[resource]
        serializer = serializer_type(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if resource == 'brand-categories':
            if data['brand'].company_id != company.pk:
                raise PermissionDenied('Brand belongs to another company.')
            if not data['category'].active:
                raise serializers.ValidationError('Category is inactive.')
        if resource == 'products' and data['brand_category'].brand.company_id != company.pk:
            raise PermissionDenied('Brand belongs to another company.')
        try:
            with transaction.atomic():
                item = serializer.save(**({'company': company} if resource == 'brands' else {}))
                audit(request, f'{resource.upper().replace("-", "_")}_CREATED', item, serializer.data)
        except IntegrityError:
            raise serializers.ValidationError('This catalogue identifier already exists.')
        return Response(serializer.data, status=201)


class OwnerProduct(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def patch(self, request, pk):
        company = owner(request)
        item = get_object_or_404(Product.objects.select_for_update(), pk=pk, brand_category__brand__company=company)
        serializer = ProductSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save()
                audit(request, 'PRODUCT_UPDATED', item, serializer.data)
        except IntegrityError:
            raise serializers.ValidationError('This catalogue identifier already exists.')
        return Response(serializer.data)


class OwnerVariants(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def post(self, request, pk):
        company = owner(request)
        product = get_object_or_404(Product.objects.select_for_update(), pk=pk, brand_category__brand__company=company)
        serializer = VariantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                item = serializer.save(product=product)
                audit(request, 'VARIANT_CREATED', item, serializer.data)
        except IntegrityError:
            raise serializers.ValidationError({'sku': 'SKU already exists for this product.'})
        return Response(serializer.data, status=201)


class OwnerVariant(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def patch(self, request, pk, variant_id):
        company = owner(request)
        product = get_object_or_404(Product.objects.select_for_update(), pk=pk, brand_category__brand__company=company)
        item = get_object_or_404(ProductVariant.objects.select_for_update(), pk=variant_id, product=product)
        serializer = VariantSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save()
                audit(request, 'VARIANT_UPDATED', item, serializer.data)
        except IntegrityError:
            raise serializers.ValidationError({'sku': 'SKU already exists for this product.'})
        return Response(serializer.data)


class StaffProducts(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'
    serializer_class = ProductSerializer
    pagination_class = Pages

    def get_queryset(self):
        qs = products()
        search = self.request.query_params.get('search', '').strip()
        return qs.filter(name__icontains=search) if search else qs


class ModerateProduct(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'

    @transaction.atomic
    def post(self, request, pk):
        class Decision(serializers.Serializer):
            action = serializers.ChoiceField(choices=['HIDE', 'SUSPEND', 'RESTORE'])
            reason = serializers.CharField(max_length=4000, allow_blank=False)
        serializer = Decision(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = get_object_or_404(Product.objects.select_for_update(), pk=pk)
        target = {'HIDE': 'HIDDEN', 'SUSPEND': 'SUSPENDED', 'RESTORE': 'VISIBLE'}[serializer.validated_data['action']]
        if item.moderation_state == target:
            return Response({'message': 'Product already has this moderation state.'}, status=409)
        item.moderation_state = target
        item.save(update_fields=['moderation_state', 'updated_at'])
        audit(request, 'PRODUCT_' + serializer.validated_data['action'], item, ProductSerializer(item).data, serializer.validated_data['reason'])
        return Response(ProductSerializer(item).data)


class OwnerBrand(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def patch(self, request, pk):
        company = owner(request)
        item = get_object_or_404(Brand.objects.select_for_update(), pk=pk, company=company)
        serializer = BrandSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save()
                audit(request, 'BRAND_UPDATED', item, serializer.data)
        except IntegrityError:
            raise serializers.ValidationError({'name': 'Brand name already exists for this company.'})
        return Response(serializer.data)


class StaffBrands(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'
    serializer_class = BrandSerializer
    pagination_class = Pages
    queryset = Brand.objects.select_related('company').prefetch_related('category_links__category').order_by('pk')


class StaffCategory(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MANAGE_TAXONOMY'

    @transaction.atomic
    def patch(self, request, pk):
        class ChangeReason(serializers.Serializer):
            reason = serializers.CharField(max_length=4000, allow_blank=False)
        reason = ChangeReason(data={'reason': request.data.get('reason', '')})
        reason.is_valid(raise_exception=True)
        item = get_object_or_404(Category.objects.select_for_update(), pk=pk)
        serializer = CategorySerializer(item, data={k: v for k, v in request.data.items() if k != 'reason'}, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                serializer.save()
                audit(request, 'CATEGORY_UPDATED', item, serializer.data, reason.validated_data['reason'])
        except IntegrityError:
            raise serializers.ValidationError({'name': 'Category name already exists.'})
        return Response(serializer.data)


class StaffCatalogueAudit(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'READ_AUDIT'
    pagination_class = Pages

    class AuditSerializer(serializers.ModelSerializer):
        class Meta:
            model = CatalogueAudit
            fields = ['id', 'company', 'brand', 'product', 'variant', 'category', 'actor', 'action', 'reason', 'snapshot', 'occurred_at']
            read_only_fields = fields
    serializer_class = AuditSerializer

    def get_queryset(self):
        qs = CatalogueAudit.objects.order_by('-pk')
        for key in ['company', 'brand', 'product']:
            value = self.request.query_params.get(key)
            if value:
                if not value.isdecimal():
                    raise serializers.ValidationError({key: 'Expected a numeric ID.'})
                qs = qs.filter(**{key + '_id': value})
        return qs
