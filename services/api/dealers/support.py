from pathlib import PurePosixPath
from uuid import uuid4

from django.db import transaction
from django.db.models import F, Q, Sum
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.dealer_gate import DealerOnboardingRequired, dealer_contacts_complete
from catalogue.media import IMAGE_EXTENSIONS, IMAGE_TYPES, validate_image
from catalogue.views import Pages
from companies.permissions import HasStaffPermission
from .models import AdminSupportMessage, AdminSupportThread
from .views import IsBusiness


class MessageInput(serializers.Serializer):
    body = serializers.CharField(max_length=4000, allow_blank=True, default='')
    attachment = serializers.FileField(required=False)

    def validate(self, attrs):
        upload = attrs.get('attachment')
        if not attrs['body'] and not upload:
            raise ValidationError('Write a message or attach a file.')
        if not upload:
            return attrs
        if upload.size > 10 * 1024 * 1024:
            raise ValidationError({'attachment': 'Choose a file up to 10 MB.'})
        suffix = PurePosixPath(upload.name).suffix.lower()
        mime = upload.content_type
        if suffix in IMAGE_EXTENSIONS and IMAGE_TYPES.get(mime) == IMAGE_EXTENSIONS[suffix]:
            validate_image(upload, mime)
            attrs['attachment_type'] = 'image'
        elif suffix == '.pdf' and mime == 'application/pdf':
            if not upload.read(8).startswith(b'%PDF-'):
                raise ValidationError({'attachment': 'Choose a valid PDF.'})
            upload.seek(max(0, upload.size - 1024))
            if not upload.read().rstrip().endswith(b'%%EOF'):
                raise ValidationError({'attachment': 'The PDF is incomplete.'})
            attrs['attachment_type'] = 'pdf'
        else:
            raise ValidationError({'attachment': 'Choose a JPEG, PNG, WebP or PDF with the matching file extension.'})
        upload.seek(0)
        return attrs


def message_data(message):
    return {key: getattr(message, key) for key in (
        'id', 'sender_role', 'body', 'attachment_type', 'attachment_name',
        'attachment_size', 'attachment_mime', 'is_read', 'created_at',
    )}


def thread_data(thread):
    dealer = thread.dealer
    return {
        'id': thread.pk, 'dealer_id': dealer.pk, 'business_name': dealer.legal_name,
        'owner_name': dealer.owner_name, 'phone': dealer.account.mobile_e164,
        'city': dealer.registered_district or dealer.registered_locality,
        'verification_status': dealer.verification_state, 'is_verified': dealer.verification_state == 'VERIFIED',
        'dealer_unread_count': thread.dealer_unread_count, 'admin_unread_count': thread.admin_unread_count,
        'last_message_at': thread.last_message_at, 'last_message_preview': thread.last_message_preview,
    }


class SupportView(APIView):
    role = 'dealer'
    permission_classes = [IsBusiness]

    def thread(self, request, thread_id):
        if self.role == 'admin':
            return get_object_or_404(AdminSupportThread.objects.select_related('dealer__account'), pk=thread_id)
        if not dealer_contacts_complete(request.user):
            raise DealerOnboardingRequired()
        return AdminSupportThread.objects.get_or_create(dealer=request.user.business_profile)[0]

    def dispatch(self, *args, **kwargs):
        response = super().dispatch(*args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response

    def get(self, request, thread_id=None, action='thread', message_id=None):
        if action == 'unread':
            if not dealer_contacts_complete(request.user):
                raise DealerOnboardingRequired()
            count = AdminSupportThread.objects.filter(dealer__account=request.user).values_list('dealer_unread_count', flat=True).first()
            return Response({'dealer_unread_count': count or 0})
        thread = self.thread(request, thread_id)
        if action == 'attachment':
            message = get_object_or_404(thread.messages, pk=message_id)
            if not message.attachment:
                raise Http404
            try:
                stream = message.attachment.open('rb')
            except FileNotFoundError:
                raise Http404
            response = FileResponse(stream, filename=message.attachment_name,
                                    content_type=message.attachment_mime, as_attachment=message.attachment_type == 'pdf')
            response['X-Content-Type-Options'] = 'nosniff'
            return response
        if action != 'thread':
            return Response(status=405)
        history = thread.messages.order_by('-pk')
        raw_before = request.query_params.get('before_id')
        if raw_before is not None:
            before = serializers.IntegerField(min_value=1, max_value=2**63 - 1).run_validation(raw_before)
            history = history.filter(pk__lt=before)
        paginator = Pages()
        newest = paginator.paginate_queryset(history, request)
        return Response({**thread_data(thread), 'messages': [message_data(item) for item in reversed(newest)],
                         'next': paginator.get_next_link()})

    def post(self, request, thread_id=None, action='thread', message_id=None):
        if action not in ('messages', 'mark-read'):
            return Response(status=405)
        thread = self.thread(request, thread_id)
        opposite = 'admin' if self.role == 'dealer' else 'dealer'
        if action == 'mark-read':
            field = serializers.IntegerField(min_value=1)
            raw = request.data.get('through_id')
            through = field.run_validation(raw) if raw is not None else None
            with transaction.atomic():
                thread = AdminSupportThread.objects.select_for_update().get(pk=thread.pk)
                unread = thread.messages.filter(sender_role=opposite, is_read=False)
                (unread if through is None else unread.filter(pk__lte=through)).update(is_read=True)
                counter = f'{self.role}_unread_count'
                setattr(thread, counter, unread.count())
                thread.save(update_fields=[counter, 'updated_at'])
            return Response(status=204)
        form = MessageInput(data=request.data)
        form.is_valid(raise_exception=True)
        body = form.validated_data['body']
        upload = form.validated_data.get('attachment')
        message = AdminSupportMessage(thread=thread, sender_role=self.role, sender_user=request.user, body=body)
        try:
            with transaction.atomic():
                thread = AdminSupportThread.objects.select_for_update().get(pk=thread.pk)
                if upload:
                    message.attachment_name = upload.name
                    message.attachment_type = form.validated_data['attachment_type']
                    message.attachment_mime = upload.content_type
                    message.attachment_size = upload.size
                    message.attachment.save(uuid4().hex + PurePosixPath(upload.name).suffix.lower(), upload, save=False)
                message.save()
                counter = f'{opposite}_unread_count'
                setattr(thread, counter, F(counter) + 1)
                thread.last_message_at = message.created_at
                thread.last_message_preview = (body or message.attachment_name)[:255]
                thread.save(update_fields=[counter, 'last_message_at', 'last_message_preview', 'updated_at'])
        except Exception:
            if message.attachment:
                message.attachment.delete(save=False)
            raise
        return Response(message_data(message), status=201)


class AdminSupport(SupportView):
    role = 'admin'
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'


class AdminInbox(AdminSupport):
    def get(self, request):
        threads = AdminSupportThread.objects.filter(last_message_at__isnull=False)
        unread = threads.aggregate(total=Sum('admin_unread_count'))['total'] or 0
        query = request.query_params.get('q', '').strip()[:120]
        if query:
            threads = threads.filter(
                Q(dealer__legal_name__icontains=query) | Q(dealer__owner_name__icontains=query)
                | Q(dealer__account__mobile_e164__icontains=query.replace(' ', '').replace('-', ''))
                | Q(dealer__registered_district__icontains=query) | Q(dealer__registered_locality__icontains=query)
            )
        paginator = Pages()
        page = paginator.paginate_queryset(threads.select_related('dealer__account').order_by('-last_message_at', '-pk'), request)
        response = paginator.get_paginated_response([thread_data(thread) for thread in page])
        response.data['total_unread'] = unread
        return response

    def post(self, request):
        return Response(status=405)
