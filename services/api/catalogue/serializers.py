import re
from rest_framework import serializers
from .media import attachment, media_metadata, media_url
from .models import Brand, BrandCategory, Category, Product, ProductVariant


class StrictSerializer(serializers.ModelSerializer):
    def to_internal_value(self, data):
        forbidden = set(data) - {name for name, field in self.fields.items() if not field.read_only}
        if forbidden:
            raise serializers.ValidationError({name: 'Unknown or read-only field.' for name in forbidden})
        return super().to_internal_value(data)


class CategorySerializer(StrictSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'active']
        read_only_fields = ['id']


class BrandSerializer(StrictSerializer):
    company_name = serializers.CharField(source='company.legal_name', read_only=True)
    company_verification = serializers.CharField(source='company.verification_state', read_only=True)
    company_activity = serializers.CharField(source='company.activity_state', read_only=True)
    categories = serializers.SerializerMethodField()

    def get_categories(self, instance):
        return [{'id': link.category_id, 'name': link.category.name, 'active': link.category.active} for link in instance.category_links.all()]

    class Meta:
        model = Brand
        fields = ['id', 'company', 'company_name', 'company_verification', 'company_activity', 'categories', 'name']
        read_only_fields = ['id', 'company']


class PublicBrandSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source='company.legal_name', read_only=True)
    categories = serializers.SerializerMethodField()

    def get_categories(self, instance):
        links = getattr(instance, 'public_category_links', instance.category_links.all())
        return [
            {'id': link.category_id, 'name': link.category.name}
            for link in links
            if link.category.active
        ]

    class Meta:
        model = Brand
        fields = ['id', 'name', 'company_name', 'categories']
        read_only_fields = fields


class BrandCategorySerializer(StrictSerializer):
    class Meta:
        model = BrandCategory
        fields = ['id', 'brand', 'category']
        read_only_fields = ['id']


class VariantSerializer(StrictSerializer):
    class Meta:
        model = ProductVariant
        fields = ['id', 'product', 'sku', 'name', 'attributes', 'active']
        read_only_fields = ['id', 'product']

    def validate_attributes(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Attributes must be a JSON object.')
        return value


class ProductSerializer(StrictSerializer):
    brand_id = serializers.IntegerField(source='brand_category.brand_id', read_only=True)
    company_id = serializers.IntegerField(source='brand_category.brand.company_id', read_only=True)
    variants = serializers.SerializerMethodField()
    brand_name = serializers.CharField(source='brand_category.brand.name', read_only=True)
    company_name = serializers.CharField(source='brand_category.brand.company.legal_name', read_only=True)
    category_name = serializers.CharField(source='brand_category.category.name', read_only=True)
    primary_image_url = serializers.SerializerMethodField()
    catalogue_pdf_url = serializers.SerializerMethodField()
    image_attachment = serializers.SerializerMethodField()
    pdf_attachment = serializers.SerializerMethodField()

    def get_primary_image_url(self, product):
        return media_url(self.context.get('request'), attachment(product, 'image'))

    def get_catalogue_pdf_url(self, product):
        return media_url(self.context.get('request'), attachment(product, 'catalogue-pdf'))

    def _staff_attachment(self, product, kind):
        item = attachment(product, kind) if self.context.get('staff_media') else None
        return media_metadata(item) if item else None

    def get_image_attachment(self, product):
        return self._staff_attachment(product, 'image')

    def get_pdf_attachment(self, product):
        return self._staff_attachment(product, 'catalogue-pdf')

    def get_variants(self, instance):
        variants = instance.variants.all()
        if self.context.get('public'):
            variants = [variant for variant in variants if variant.active]
        return VariantSerializer(variants, many=True).data

    class Meta:
        model = Product
        fields = ['id', 'brand_category', 'brand_id', 'company_id', 'brand_name', 'company_name', 'category_name', 'name', 'code', 'description', 'specifications', 'unit', 'catalogue_price', 'currency', 'state', 'moderation_state', 'updated_at', 'variants', 'primary_image_url', 'catalogue_pdf_url', 'image_attachment', 'pdf_attachment']
        read_only_fields = ['id', 'moderation_state', 'updated_at']

    def validate_specifications(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('Specifications must be a JSON object.')
        return value

    def validate(self, attrs):
        instance = self.instance
        association = attrs.get('brand_category', getattr(instance, 'brand_category', None))
        if instance and association.pk != instance.brand_category_id:
            raise serializers.ValidationError({'brand_category': 'Product ownership and association are immutable.'})
        if association and not association.category.active:
            raise serializers.ValidationError({'brand_category': 'Category is inactive.'})
        price = attrs.get('catalogue_price', getattr(instance, 'catalogue_price', None))
        currency = attrs.get('currency', getattr(instance, 'currency', ''))
        if (price is None and currency) or (price is not None and (price < 0 or currency != 'INR')):
            raise serializers.ValidationError('Catalogue price must be nonnegative and use INR; omit both amount and currency when unspecified.')
        return attrs
