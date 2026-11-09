from django.db import IntegrityError, transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AccountType, BusinessProfile
from catalogue.views import Pages
from companies.permissions import HasStaffPermission
from dealers.views import eligible_listings
from .models import Enquiry, EnquiryAudit, EnquiryItem, QuotationItem, QuotationRevision
from .serializers import (
    BuyerResponseSerializer, DeclineSerializer, EnquiryCreateSerializer,
    EnquirySerializer, QuotationCreateSerializer,
)


class IsBuyer(BasePermission):
    message = 'A PERSONAL buyer account is required.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.account_type == AccountType.PERSONAL)


class IsDealer(BasePermission):
    message = 'An active BUSINESS dealer account is required.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.account_type == AccountType.BUSINESS)


def records():
    return Enquiry.objects.select_related('buyer', 'branch__business__account').prefetch_related(
        'items__listing__product', 'items__listing__variant',
        'quotations__items__enquiry_item__listing__product',
        'quotations__items__enquiry_item__listing__variant',
    ).order_by('-pk')


def paginate(request, queryset):
    pages = Pages()
    rows = pages.paginate_queryset(queryset, request)
    return pages.get_paginated_response(EnquirySerializer(rows, many=True).data)


def audit(enquiry, actor, action, reason='', quotation=None):
    snapshot = EnquirySerializer(enquiry).data
    EnquiryAudit.objects.create(enquiry=enquiry, quotation=quotation, actor=actor, action=action, reason=reason, snapshot=snapshot)


def dealer_profile(request, verified=True):
    dealer = get_object_or_404(BusinessProfile.objects.select_for_update(), account=request.user)
    if dealer.verification_state in ['REJECTED', 'SUSPENDED'] or (verified and dealer.verification_state != 'VERIFIED'):
        raise PermissionDenied('Business verification does not permit enquiry management.')
    return dealer


class BuyerEnquiries(APIView):
    permission_classes = [IsBuyer]

    def get(self, request):
        return paginate(request, records().filter(buyer=request.user))

    @transaction.atomic
    def post(self, request):
        serializer = EnquiryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        listing_by_id = data.pop('eligible_listings')
        item_data = data.pop('items')
        data.pop('branch')
        first = listing_by_id[item_data[0]['listing'].pk]
        enquiry = Enquiry.objects.create(buyer=request.user, branch=first.location, **data)
        for item in item_data:
            EnquiryItem.objects.create(
                enquiry=enquiry, listing=listing_by_id[item['listing'].pk],
                quantity=item['quantity'], requirement=item['requirement'],
            )
        enquiry = records().get(pk=enquiry.pk)
        audit(enquiry, request.user, 'ENQUIRY_SUBMITTED')
        return Response(EnquirySerializer(enquiry).data, status=201)


class BuyerEnquiryDetail(APIView):
    permission_classes = [IsBuyer]

    def get(self, request, pk):
        return Response(EnquirySerializer(get_object_or_404(records(), pk=pk, buyer=request.user)).data)


class BuyerQuotationResponse(APIView):
    permission_classes = [IsBuyer]

    @transaction.atomic
    def post(self, request, pk):
        enquiry = get_object_or_404(Enquiry.objects.select_for_update(), pk=pk, buyer=request.user)
        serializer = BuyerResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        quotation = enquiry.quotations.select_for_update().filter(state='SENT').order_by('-revision').first()
        if enquiry.state != Enquiry.State.QUOTED or quotation is None:
            raise ValidationError('There is no current quotation awaiting a response.')
        if quotation.valid_until <= timezone.now():
            return Response({'code': 'QUOTATION_EXPIRED', 'message': 'This quotation has expired. Ask the dealer for a revision.'}, status=409)
        action = serializer.validated_data['action']
        reason = serializer.validated_data['reason'].strip()
        quotation.state = QuotationRevision.State.ACCEPTED if action == 'ACCEPT' else QuotationRevision.State.REJECTED
        quotation.responded_at = timezone.now()
        quotation.save(update_fields=['state', 'responded_at'])
        enquiry.state = Enquiry.State.ACCEPTED if action == 'ACCEPT' else Enquiry.State.REJECTED
        enquiry.save(update_fields=['state', 'updated_at'])
        current = records().get(pk=enquiry.pk)
        audit(current, request.user, f'QUOTATION_{action}ED', reason, quotation)
        return Response(EnquirySerializer(current).data)


class DealerEnquiries(APIView):
    permission_classes = [IsDealer]

    def get(self, request):
        dealer = get_object_or_404(BusinessProfile, account=request.user)
        queryset = records().filter(branch__business=dealer)
        state = request.query_params.get('state')
        if state:
            if state not in Enquiry.State.values:
                raise ValidationError({'state': 'Invalid enquiry state.'})
            queryset = queryset.filter(state=state)
        return paginate(request, queryset)


class DealerEnquiryDetail(APIView):
    permission_classes = [IsDealer]

    def get(self, request, pk):
        return Response(EnquirySerializer(get_object_or_404(records(), pk=pk, branch__business__account=request.user)).data)


class DealerDecline(APIView):
    permission_classes = [IsDealer]

    @transaction.atomic
    def post(self, request, pk):
        dealer = dealer_profile(request)
        enquiry = get_object_or_404(Enquiry.objects.select_for_update(), pk=pk, branch__business=dealer)
        serializer = DeclineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if enquiry.state not in [Enquiry.State.SUBMITTED, Enquiry.State.QUOTED, Enquiry.State.REJECTED]:
            raise ValidationError('This enquiry can no longer be declined.')
        enquiry.quotations.filter(state='SENT').update(state='SUPERSEDED')
        enquiry.state = Enquiry.State.DECLINED
        enquiry.save(update_fields=['state', 'updated_at'])
        current = records().get(pk=enquiry.pk)
        audit(current, request.user, 'ENQUIRY_DECLINED', serializer.validated_data['reason'])
        return Response(EnquirySerializer(current).data)


class DealerQuotations(APIView):
    permission_classes = [IsDealer]

    @transaction.atomic
    def post(self, request, pk):
        dealer = dealer_profile(request)
        enquiry = get_object_or_404(Enquiry.objects.select_for_update(), pk=pk, branch__business=dealer)
        if enquiry.state not in [Enquiry.State.SUBMITTED, Enquiry.State.QUOTED, Enquiry.State.REJECTED]:
            raise ValidationError('This enquiry does not permit another quotation revision.')
        if eligible_listings().filter(pk__in=enquiry.items.values('listing_id')).count() != enquiry.items.count():
            raise PermissionDenied('One or more enquiry listings are no longer eligible for quotation.')
        serializer = QuotationCreateSerializer(data=request.data, context={'enquiry': enquiry})
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        item_data = values.pop('items')
        previous = enquiry.quotations.select_for_update().filter(state='SENT')
        previous.update(state='SUPERSEDED')
        revision = (enquiry.quotations.aggregate(value=Max('revision'))['value'] or 0) + 1
        try:
            quotation = QuotationRevision.objects.create(enquiry=enquiry, revision=revision, sent_by=request.user, **values)
            for item in item_data:
                QuotationItem.objects.create(quotation=quotation, **item)
        except IntegrityError as exc:
            raise ValidationError('Conflicting quotation revision or invalid quotation item.') from exc
        enquiry.state = Enquiry.State.QUOTED
        enquiry.save(update_fields=['state', 'updated_at'])
        current = records().get(pk=enquiry.pk)
        audit(current, request.user, 'QUOTATION_SENT' if revision == 1 else 'QUOTATION_REVISED', quotation=quotation)
        return Response(EnquirySerializer(current).data, status=201)


class StaffEnquiries(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'READ_REPORTS'

    def get(self, request):
        queryset = records()
        state = request.query_params.get('state')
        if state:
            if state not in Enquiry.State.values:
                raise ValidationError({'state': 'Invalid enquiry state.'})
            queryset = queryset.filter(state=state)
        return paginate(request, queryset)


class StaffEnquiryDetail(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'READ_REPORTS'

    def get(self, request, pk):
        enquiry = get_object_or_404(records(), pk=pk)
        data = EnquirySerializer(enquiry).data
        data['audit'] = list(enquiry.audit_events.order_by('pk').values('id', 'action', 'actor_id', 'quotation_id', 'reason', 'occurred_at'))
        return Response(data)
