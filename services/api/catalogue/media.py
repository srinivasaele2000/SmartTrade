from io import BytesIO
from pathlib import PurePath
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import transaction
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_safe
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from companies.permissions import HasStaffPermission
from .models import Product, ProductMedia


IMAGE_TYPES = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}
IMAGE_EXTENSIONS = {'.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.webp': 'WEBP'}
PREFERRED_EXTENSION = {'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp'}
MAX_IMAGE_DIMENSION = 4096


def attachment(product, kind):
    return next((item for item in product.official_media.all() if item.kind == kind), None)


def storage():
    return FileSystemStorage(location=settings.CATALOGUE_MEDIA_ROOT)


def media_url(request, item):
    if item is None or request is None or not settings.DEBUG:
        return None
    return request.build_absolute_uri(reverse('catalogue-media', kwargs={'key': item.key}))


def media_metadata(item):
    return {
        'filename': item.filename,
        'size': item.size,
        'content_type': item.content_type,
        'uploaded_at': item.uploaded_at.isoformat(),
    }


def validate_image(upload, content_type):
    if content_type not in IMAGE_TYPES:
        raise serializers.ValidationError({'file': 'Use JPEG, PNG or WebP.'})

    # The upload is already size-limited. Give Pillow its own streams so that
    # verification and decoding cannot close or reposition the file we save.
    upload.seek(0)
    contents = upload.read()
    try:
        with Image.open(BytesIO(contents), formats=list(IMAGE_TYPES.values())) as decoded:
            extension = PurePath(upload.name).suffix.lower()
            extension_format = IMAGE_EXTENSIONS.get(extension)
            if extension_format and decoded.format != extension_format:
                raise serializers.ValidationError({
                    'file': f'This image appears to be a {decoded.format} saved with a {extension} extension. '
                    f'Please rename it to {PREFERRED_EXTENSION[decoded.format]} or re-export as {extension_format}.',
                })
            if decoded.format != IMAGE_TYPES[content_type]:
                raise serializers.ValidationError({
                    'file': f'File contents are {decoded.format}, but the upload declares {content_type}. '
                    'Export the image as JPEG, PNG or WebP with the matching extension.',
                })
            if max(decoded.size) > MAX_IMAGE_DIMENSION:
                raise serializers.ValidationError({
                    'file': f'Image dimensions ({decoded.width} × {decoded.height} px) exceed the maximum '
                    f'allowed size ({MAX_IMAGE_DIMENSION} × {MAX_IMAGE_DIMENSION} px).',
                })
            decoded.verify()
        with Image.open(BytesIO(contents), formats=[IMAGE_TYPES[content_type]]) as decoded:
            decoded.load()
    except Image.DecompressionBombError:
        raise serializers.ValidationError({
            'file': f'Image is too large to decode safely. Resize it to at most '
            f'{MAX_IMAGE_DIMENSION}×{MAX_IMAGE_DIMENSION} px and try again.',
        })
    except (UnidentifiedImageError, OSError, EOFError, ValueError, SyntaxError):
        raise serializers.ValidationError({
            'file': 'The uploaded file could not be recognized as a valid image. Please verify the file is not damaged.',
        })


def validate_file(upload, kind):
    if upload is None:
        raise serializers.ValidationError({'file': 'Select a file.'})
    content_type = upload.content_type
    image = kind == ProductMedia.Kind.IMAGE
    limit = 2 if image else 10
    if not upload.size:
        raise serializers.ValidationError({'file': 'The selected file is empty. Choose another file.'})
    if upload.size > limit * 1024 * 1024:
        raise serializers.ValidationError({'file': f'File size exceeds the {limit} MB limit.'})
    if image:
        validate_image(upload, content_type)
    else:
        if content_type != 'application/pdf' or not upload.read(8).startswith(b'%PDF-'):
            raise serializers.ValidationError({'file': 'Use a valid PDF file.'})
        upload.seek(max(0, upload.size - 1024))
        if not upload.read().rstrip().endswith(b'%%EOF'):
            raise serializers.ValidationError({'file': 'PDF file is incomplete.'})
    upload.seek(0)


def file_response(item, private=False):
    try:
        stream = storage().open(item.storage_name, 'rb')
    except FileNotFoundError:
        raise Http404
    response = FileResponse(
        stream, filename=item.filename, content_type=item.content_type,
        as_attachment=item.kind == ProductMedia.Kind.PDF,
    )
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store' if private else 'public, max-age=3600'
    return response


@require_safe
def public_media(request, key):
    if not settings.DEBUG:
        raise Http404
    from .views import eligible_products
    item = get_object_or_404(ProductMedia, key=key, product_id__in=eligible_products().values('pk'))
    return file_response(item)


class StaffProductMedia(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'MODERATE_PRODUCTS'
    parser_classes = [MultiPartParser]

    def get(self, request, pk, kind):
        return file_response(get_object_or_404(ProductMedia, product_id=pk, kind=kind), private=True)

    def post(self, request, pk, kind):
        from .views import audit
        upload = request.FILES.get('file')
        validate_file(upload, kind)
        files = storage()
        new_name = None
        try:
            with transaction.atomic():
                product = get_object_or_404(Product.objects.select_for_update(), pk=pk)
                previous = ProductMedia.objects.filter(product=product, kind=kind).first()
                item, _ = ProductMedia.objects.update_or_create(
                    product=product, kind=kind,
                    defaults={'key': uuid4(), 'filename': upload.name, 'content_type': upload.content_type, 'size': upload.size},
                )
                new_name = item.storage_name
                new_name = files.save(new_name, upload)
                if new_name != item.storage_name:
                    raise OSError('Could not allocate the catalogue media path.')
                audit(request, 'PRODUCT_MEDIA_UPLOADED', product, {'kind': kind, **media_metadata(item)})
                if previous:
                    transaction.on_commit(lambda: files.delete(previous.storage_name), robust=True)
        except Exception:
            if new_name is not None:
                files.delete(new_name)
            raise
        return Response(media_metadata(item), status=200 if previous else 201)

    @transaction.atomic
    def delete(self, request, pk, kind):
        from .views import audit
        product = get_object_or_404(Product.objects.select_for_update(), pk=pk)
        item = get_object_or_404(ProductMedia, product=product, kind=kind)
        audit(request, 'PRODUCT_MEDIA_REMOVED', product, {'kind': kind, **media_metadata(item)})
        name = item.storage_name
        item.delete()
        transaction.on_commit(lambda: storage().delete(name), robust=True)
        return Response(status=204)
