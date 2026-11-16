from pathlib import PurePath
from uuid import uuid4

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.dealer_gate import DealerOnboardingRequired, dealer_contacts_complete
from catalogue.media import IMAGE_EXTENSIONS, IMAGE_TYPES, validate_image
from catalogue.views import eligible_products
from companies.permissions import HasStaffPermission
from .models import DealerBanner
from .views import IsBusiness


def banners():
    return DealerBanner.objects.select_related('target_brand', 'target_category')


def current():
    now = timezone.now()
    return banners().filter(is_active=True).filter(
        Q(starts_at__isnull=True) | Q(starts_at__lte=now),
        Q(ends_at__isnull=True) | Q(ends_at__gte=now),
    )


class BannerInput(serializers.ModelSerializer):
    image = serializers.FileField(required=False, allow_null=True)
    is_active = serializers.BooleanField(default=True)

    class Meta:
        model = DealerBanner
        fields = ('title', 'subtitle', 'image', 'banner_type', 'theme_preset', 'badge_text', 'target_type', 'target_brand', 'target_category',
                  'target_item', 'sort_order', 'is_active', 'starts_at', 'ends_at')

    def validate_image(self, upload):
        if upload.size > 8 * 1024 * 1024:
            raise serializers.ValidationError('Choose an image up to 8 MB.')
        suffix = PurePath(upload.name).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS or IMAGE_TYPES.get(upload.content_type) != IMAGE_EXTENSIONS[suffix]:
            raise serializers.ValidationError('Choose a JPEG, PNG or WebP with a matching extension.')
        validate_image(upload, upload.content_type)
        upload.seek(0)
        return upload

    def validate(self, attrs):
        def value(key, default=None):
            return attrs.get(key, getattr(self.instance, key, default))

        if 'banner_type' not in attrs:
            attrs['banner_type'] = 'image' if attrs.get('image') else value('banner_type', 'text')
        if attrs['banner_type'] == 'text':
            if not value('title'):
                raise serializers.ValidationError({'title': 'Enter a headline for the text banner.'})
            if attrs.get('image'):
                raise serializers.ValidationError({'image': 'Select Image Banner to upload a file.'})
        elif not value('image'):
            raise serializers.ValidationError({'image': 'Choose an image for the image banner.'})

        start, end = value('starts_at'), value('ends_at')
        if start and end and end < start:
            raise serializers.ValidationError({'ends_at': 'End must be on or after start.'})
        if 'target_type' in attrs:
            for name in ('brand', 'category', 'item'):
                field = 'target_' + name
                if name != attrs['target_type'] and field not in attrs:
                    attrs[field] = None
        target_type = value('target_type', 'none')
        if any(bool(value('target_' + name)) != (target_type == name) for name in ('brand', 'category', 'item')):
            raise serializers.ValidationError({'target_type': 'Select exactly the destination for this tap action.'})
        return attrs


def output(banner, scope, now, available=None):
    target = banner.target_type
    if available is not None and target in available and getattr(banner, f'target_{target}_id') not in available[target]:
        target = 'none'
    path = None
    if banner.banner_type == 'image' and banner.image:
        path = f'/banners/{scope}/{banner.pk}/image/?v={int(banner.updated_at.timestamp() * 1000000)}'
    data = {
        'id': banner.pk, 'title': banner.title, 'subtitle': banner.subtitle, 'image_url': path,
        'banner_type': banner.banner_type, 'theme_preset': banner.theme_preset, 'badge_text': banner.badge_text,
        'target_type': target, 'target_brand_id': banner.target_brand_id,
        'target_brand_name': banner.target_brand.name if banner.target_brand else None,
        'target_category_id': banner.target_category_id,
        'target_category_name': banner.target_category.name if banner.target_category else None,
        'target_item_id': banner.target_item_id, 'sort_order': banner.sort_order,
    }
    if scope == 'admin':
        state = 'Inactive' if not banner.is_active else 'Scheduled' if banner.starts_at and banner.starts_at > now else 'Expired' if banner.ends_at and banner.ends_at < now else 'Active'
        data.update(status=state, is_active=banner.is_active, starts_at=banner.starts_at, ends_at=banner.ends_at)
    return data


class PrivateBannerView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response

    def image(self, banner):
        if banner.banner_type != 'image' or not banner.image:
            raise Http404
        try:
            response = FileResponse(banner.image.open('rb'), content_type=banner.image_mime)
        except FileNotFoundError as exc:
            raise Http404 from exc
        response['X-Content-Type-Options'] = 'nosniff'
        return response


class DealerBanners(PrivateBannerView):
    permission_classes = [IsBusiness]

    def get(self, request, pk=None):
        if not dealer_contacts_complete(request.user):
            raise DealerOnboardingRequired()
        if pk is not None:
            return self.image(get_object_or_404(current(), pk=pk))
        rows = list(current())
        products = eligible_products()
        available = {}
        for kind, field in (('brand', 'brand_category__brand_id'), ('category', 'brand_category__category_id'), ('item', 'pk')):
            ids = {getattr(row, f'target_{kind}_id') for row in rows if row.target_type == kind}
            available[kind] = set(products.filter(**{f'{field}__in': ids}).values_list(field, flat=True).distinct())
        now = timezone.now()
        return Response({'banners': [output(row, 'dealer', now, available) for row in rows]})


class AdminBanners(PrivateBannerView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'

    def get(self, request, pk=None, image=False):
        if pk is not None:
            row = get_object_or_404(banners(), pk=pk)
            return self.image(row) if image else Response(output(row, 'admin', timezone.now()))
        now = timezone.now()
        return Response({'banners': [output(row, 'admin', now) for row in banners()]})

    def save_banner(self, request, pk=None):
        saved_file = None
        try:
            with transaction.atomic():
                row = get_object_or_404(DealerBanner.objects.select_for_update(), pk=pk) if pk else DealerBanner(created_by=request.user)
                form = BannerInput(row if pk else None, data=request.data, partial=pk is not None)
                form.is_valid(raise_exception=True)
                fields = dict(form.validated_data)
                upload = fields.pop('image', None)
                for key, value in fields.items():
                    setattr(row, key, value)
                previous = row.image.name
                storage = row.image.storage
                if upload:
                    row.image.save(uuid4().hex + PurePath(upload.name).suffix.lower(), upload, save=False)
                    saved_file = row.image
                    row.image_mime = upload.content_type
                elif row.banner_type == 'text':
                    row.image = None
                    row.image_mime = ''
                if previous and previous != row.image.name:
                    transaction.on_commit(lambda: storage.delete(previous), robust=True)
                row.save()
        except Exception:
            if saved_file:
                saved_file.delete(save=False)
            raise
        return Response(output(row, 'admin', timezone.now()), status=200 if pk else 201)

    def post(self, request, pk=None, image=False):
        return self.save_banner(request) if pk is None and not image else Response(status=405)

    def patch(self, request, pk=None, image=False):
        return self.save_banner(request, pk) if pk and not image else Response(status=405)

    @transaction.atomic
    def delete(self, request, pk=None, image=False):
        if not pk or image:
            return Response(status=405)
        row = get_object_or_404(DealerBanner.objects.select_for_update(), pk=pk)
        file = row.image
        row.delete()
        if file:
            transaction.on_commit(lambda: file.delete(save=False), robust=True)
        return Response(status=204)


class AdminBannerReorder(AdminBanners):
    http_method_names = ['post', 'options']
    @transaction.atomic
    def post(self, request):
        ids = serializers.ListField(child=serializers.IntegerField(min_value=1, max_value=2**63 - 1)).run_validation(request.data.get('ids'))
        rows = {row.pk: row for row in DealerBanner.objects.select_for_update().order_by('pk')}
        if len(ids) != len(rows) or set(ids) != rows.keys():
            raise serializers.ValidationError({'ids': 'Reload banners and provide each banner once.'})
        for order, pk in enumerate(ids):
            rows[pk].sort_order = order
        DealerBanner.objects.bulk_update(rows.values(), ['sort_order'])
        now = timezone.now()
        return Response({'banners': [output(row, 'admin', now) for row in banners()]})
