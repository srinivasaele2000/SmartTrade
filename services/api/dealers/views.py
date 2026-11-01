import unicodedata
from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Q, Value, BooleanField
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from accounts.models import AccountType, BusinessProfile
from accounts.permissions import IsActiveAccount
from catalogue.models import Brand
from catalogue.views import Pages, eligible_products
from companies.models import CompanyProfile
from companies.permissions import HasStaffPermission, IsCompanyAccount
from .models import AuthorizedDealerGrant, DealerAudit, DealerLocation, DealerProductListing
from .serializers import BusinessSerializer, DiscoverySerializer, GrantSerializer, ListingSerializer, LocationSerializer


class IsBusiness(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_active and request.user.account_type == AccountType.BUSINESS


def business(request, verified=False):
    item = get_object_or_404(BusinessProfile.objects.select_for_update(), account=request.user)
    if item.verification_state in ['REJECTED', 'SUSPENDED'] or (verified and item.verification_state != 'VERIFIED'):
        raise PermissionDenied('Business verification does not permit this operation.')
    return item


def listings():
    return DealerProductListing.objects.select_related('location__business__account', 'product__brand_category__brand__company', 'variant').order_by('pk')


def eligible_listings():
    grant = AuthorizedDealerGrant.objects.filter(active=True, business_id=OuterRef('location__business_id'), brand_id=OuterRef('product__brand_category__brand_id'), company_id=OuterRef('product__brand_category__brand__company_id'))
    return listings().filter(
        state='PUBLISHED', location__active=True, location__admin_hidden=False, location__visibility_state='VISIBLE',
        location__business__verification_state='VERIFIED', location__business__account__access_state='ACTIVE',
        product_id__in=eligible_products().values('pk'),
    ).filter(Q(variant__isnull=True) | Q(variant__active=True)).annotate(has_grant=Exists(grant)).filter(has_grant=True).annotate(currently_eligible=Value(True, output_field=BooleanField()))


def managed_listings():
    return listings().annotate(currently_eligible=Exists(eligible_listings().filter(pk=OuterRef('pk'))))


def filter_listings(request, qs, staff=False):
    fields = {'location': 'location_id', 'product': 'product_id'}
    if staff:
        fields.update({'business': 'location__business_id', 'company': 'product__brand_category__brand__company_id', 'brand': 'product__brand_category__brand_id'})
    for key, field in fields.items():
        value = request.query_params.get(key)
        if value:
            if not value.isdecimal():
                raise serializers.ValidationError({key: 'Expected numeric ID.'})
            qs = qs.filter(**{field: value})
    for key, values in [('state', ['PUBLISHED', 'WITHDRAWN']), ('stock_status', ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'])]:
        value = request.query_params.get(key)
        if value:
            if value not in values:
                raise serializers.ValidationError({key: 'Invalid listing filter.'})
            qs = qs.filter(**{key: value})
    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(Q(product__name__icontains=search) | Q(product__code__icontains=search) | Q(variant__sku__icontains=search) | Q(location__branch_name__icontains=search) | Q(location__business__legal_name__icontains=search) | Q(product__brand_category__brand__name__icontains=search) | Q(product__brand_category__brand__company__legal_name__icontains=search))
    return qs


def audit(request, business, action, snapshot, reason='', location=None, listing=None, grant=None):
    DealerAudit.objects.create(business=business, actor=request.user, action=action, snapshot=snapshot, reason=reason, location=location, listing=listing, grant=grant)


def page(request, qs, serializer):
    pages = Pages()
    return pages.get_paginated_response(serializer(pages.paginate_queryset(qs, request), many=True).data)


def save_validated(request, serializer, dealer, action, **kwargs):
    try:
        with transaction.atomic():
            item = serializer.save(**kwargs)
            audit(request, dealer, action, serializer.data,
                  location=item if isinstance(item, DealerLocation) else item.location if isinstance(item, DealerProductListing) else None,
                  listing=item if isinstance(item, DealerProductListing) else None)
    except IntegrityError:
        raise serializers.ValidationError('Conflicting identifier, invalid association or ineligible publication.')
    return Response(serializer.data, status=200 if request.method == 'PATCH' else 201)


class BusinessMe(APIView):
    permission_classes = [IsBusiness]

    def get(self, request):
        item = get_object_or_404(BusinessProfile, account=request.user)
        grants = item.dealer_grants.select_related('brand', 'company__owner_account').order_by('pk')
        editable = item.verification_state not in ['REJECTED', 'SUSPENDED']
        verified = item.verification_state == 'VERIFIED'
        result = BusinessSerializer(item).data
        result['workspace'] = {
            'branch_count': item.locations.count(),
            'published_listing_count': DealerProductListing.objects.filter(location__business=item, state='PUBLISHED').count(),
            'discoverable_listing_count': eligible_listings().filter(location__business=item).count(),
            'can_edit': editable,
            'can_publish_branches': verified,
            'can_manage_listings': verified,
            'authorizations': [{
                'id': grant.pk, 'brand': grant.brand_id, 'brand_name': grant.brand.name,
                'company': grant.company_id, 'company_name': grant.company.legal_name,
                'active': grant.active, 'company_verification_state': grant.company.verification_state,
                'company_activity_state': grant.company.activity_state,
                'eligible': grant.active and verified and grant.company.can_publish_catalogue,
                'updated_at': grant.updated_at,
            } for grant in grants],
        }
        return Response(result, headers={'Cache-Control': 'no-store'})

    @transaction.atomic
    def patch(self, request):
        item = business(request)
        serializer = BusinessSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return save_validated(request, serializer, item, 'BUSINESS_UPDATED')


class Locations(APIView):
    permission_classes = [IsBusiness]

    def get(self, request):
        return page(request, DealerLocation.objects.filter(business__account=request.user).order_by('pk'), LocationSerializer)

    @transaction.atomic
    def post(self, request):
        item = business(request)
        serializer = LocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get('visibility_state') == 'VISIBLE' and item.verification_state != 'VERIFIED':
            raise PermissionDenied('Only verified businesses can publish branches.')
        return save_validated(request, serializer, item, 'LOCATION_CREATED', business=item)


class LocationDetail(APIView):
    permission_classes = [IsBusiness]

    def get(self, request, pk):
        return Response(LocationSerializer(get_object_or_404(DealerLocation, pk=pk, business__account=request.user)).data)

    @transaction.atomic
    def patch(self, request, pk):
        item = business(request)
        location = get_object_or_404(DealerLocation.objects.select_for_update(), pk=pk, business=item)
        serializer = LocationSerializer(location, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get('visibility_state', location.visibility_state) == 'VISIBLE' and item.verification_state != 'VERIFIED':
            raise PermissionDenied('Only verified businesses can publish branches.')
        return save_validated(request, serializer, item, 'LOCATION_UPDATED')


class Listings(APIView):
    permission_classes = [IsBusiness]

    def get(self, request):
        qs = filter_listings(request, managed_listings().filter(location__business__account=request.user))
        response = page(request, qs, ListingSerializer)
        response['Cache-Control'] = 'private, no-store'
        return response

    @transaction.atomic
    def post(self, request):
        item = business(request, verified=True)
        return listing_write(request, item)


def listing_write(request, item, listing=None):
    serializer = ListingSerializer(listing, data=request.data, partial=listing is not None)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    location = values.get('location', getattr(listing, 'location', None))
    if location.business_id != item.pk:
        raise PermissionDenied('Branch belongs to another business.')
    # Withdrawal remains possible after company revocation/suspension, with no content edits.
    withdrawing = listing is not None and values == {'state': 'WITHDRAWN'}
    product = values.get('product', getattr(listing, 'product', None))
    variant = values.get('variant', getattr(listing, 'variant', None))
    if not withdrawing:
        if not location.active or location.admin_hidden or location.visibility_state != 'VISIBLE':
            raise PermissionDenied('An active visible branch is required.')
        if not eligible_products().filter(pk=product.pk).exists() or (variant and not variant.active):
            raise PermissionDenied('Product or variant is not eligible.')
        if not AuthorizedDealerGrant.objects.filter(business=item, brand=product.brand_category.brand, company=product.brand_category.brand.company, active=True).exists():
            raise PermissionDenied('Explicit company authorization is required for this brand.')
    return save_validated(request, serializer, item, 'LISTING_WITHDRAWN' if withdrawing else 'LISTING_UPDATED' if listing else 'LISTING_CREATED')


class ListingDetail(APIView):
    permission_classes = [IsBusiness]

    def get(self, request, pk):
        return Response(ListingSerializer(get_object_or_404(managed_listings(), pk=pk, location__business__account=request.user)).data, headers={'Cache-Control': 'private, no-store'})

    @transaction.atomic
    def patch(self, request, pk):
        item = business(request, verified=True)
        listing = get_object_or_404(DealerProductListing.objects.select_for_update(), pk=pk, location__business=item)
        return listing_write(request, item, listing)


class CompanyGrants(APIView):
    permission_classes = [IsCompanyAccount]

    def get(self, request):
        response = page(request, authorization_filters(request, grant_records().filter(company__owner_account=request.user)), GrantSerializer)
        response['Cache-Control'] = 'private, no-store'
        return response

    @transaction.atomic
    def post(self, request):
        company = get_object_or_404(CompanyProfile.objects.select_for_update(), owner_account=request.user)
        if not company.can_publish_catalogue:
            raise PermissionDenied('A verified active company is required.')
        # Serialize scope transitions with company and business locks. No-op
        # submissions must not create duplicate grants or audit history.
        class Input(serializers.Serializer):
            brand = serializers.PrimaryKeyRelatedField(queryset=Brand.objects.filter(company=company))
            business = serializers.PrimaryKeyRelatedField(queryset=BusinessProfile.objects.all())
            active = serializers.BooleanField()
            reason = serializers.CharField(max_length=4000, allow_blank=False)
        unknown = set(request.data) - {'brand', 'business', 'active', 'reason'}
        if unknown:
            raise serializers.ValidationError({key: 'Unknown or read-only field.' for key in unknown})
        serializer = Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        dealer = get_object_or_404(BusinessProfile.objects.select_for_update().select_related('account'), pk=data['business'].pk)
        if dealer.account_id == request.user.pk or dealer.account.account_type != AccountType.BUSINESS:
            raise PermissionDenied('Self-authorization is forbidden.')
        if data['active'] and (dealer.verification_state != 'VERIFIED' or not dealer.account.is_active):
            raise serializers.ValidationError('Only verified active dealer businesses can be authorized.')
        grant = AuthorizedDealerGrant.objects.select_for_update().filter(company=company, brand=data['brand'], business=dealer).first()
        if grant is None and not data['active']:
            return Response({'code': 'AUTHORIZATION_NOT_FOUND', 'message': 'No existing authorization can be revoked.'}, status=404)
        if grant is not None and grant.active == data['active']:
            return Response({'code': 'AUTHORIZATION_UNCHANGED', 'message': 'This authorization already has the requested status.'}, status=409)
        if grant is None:
            grant = AuthorizedDealerGrant.objects.create(company=company, brand=data['brand'], business=dealer, active=True, actor=request.user, reason=data['reason'])
        else:
            grant.active, grant.actor, grant.reason = data['active'], request.user, data['reason']
            grant.save(update_fields=['active', 'actor', 'reason', 'updated_at'])
        audit(request, data['business'], 'DEALER_AUTHORIZATION_GRANTED' if data['active'] else 'DEALER_AUTHORIZATION_REVOKED', GrantSerializer(grant).data, data['reason'], grant=grant)
        return Response(GrantSerializer(grant).data)


class Discovery(APIView):
    permission_classes = [IsActiveAccount]

    def get(self, request):
        qs = eligible_listings()
        for param, field in [('product', 'product_id'), ('brand', 'product__brand_category__brand_id'), ('variant', 'variant_id')]:
            value = request.query_params.get(param)
            if value:
                if not value.isdecimal():
                    raise serializers.ValidationError({param: 'Expected numeric ID.'})
                qs = qs.filter(**{field: value})
        stock = request.query_params.get('stock_status')
        if stock:
            if stock not in ['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']:
                raise serializers.ValidationError({'stock_status': 'Invalid stock status.'})
            qs = qs.filter(stock_status=stock)
        match = 'UNFILTERED'
        for key in ['pin_code', 'locality', 'district']:
            value = request.query_params.get(key)
            if value:
                value = ' '.join(unicodedata.normalize('NFKC', value).split()).upper()
                if key == 'pin_code':
                    value = ''.join(value.split())
                if not value:
                    raise serializers.ValidationError({key: 'Location filter cannot be blank.'})
                candidate = qs.filter(**{'location__' + key: value})
                if candidate.exists():
                    qs = candidate
                    match = key.upper()
                    break
                qs_for_fallback = candidate
        else:
            if any(request.query_params.get(key) for key in ['pin_code', 'locality', 'district']):
                qs = qs_for_fallback
                match = 'NO_LOCATION_MATCH'
        response = page(request, qs, DiscoverySerializer)
        response.data['match_level'] = match
        response['Cache-Control'] = 'private, no-store'
        return response


class DiscoveryDetail(generics.RetrieveAPIView):
    def get(self, request, *args, **kwargs):
        response = super().get(request, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response

    permission_classes = [IsActiveAccount]
    serializer_class = DiscoverySerializer

    def get_queryset(self):
        return eligible_listings()


class StaffBusinesses(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'
    serializer_class = BusinessSerializer
    pagination_class = Pages

    def get_queryset(self):
        qs = BusinessProfile.objects.order_by('pk')
        state = self.request.query_params.get('verification_state')
        if state:
            if state not in ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']:
                raise serializers.ValidationError('Invalid verification state.')
            qs = qs.filter(verification_state=state)
        return qs


class StaffBusinessDecision(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'

    @transaction.atomic
    def post(self, request, pk):
        class Input(serializers.Serializer):
            action = serializers.ChoiceField(choices=['APPROVE', 'REJECT', 'SUSPEND', 'RESTORE'])
            reason = serializers.CharField(max_length=4000, allow_blank=False)
        serializer = Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = get_object_or_404(BusinessProfile.objects.select_for_update(), pk=pk)
        if item.account_id == request.user.pk:
            raise PermissionDenied('Self review is forbidden.')
        action = serializer.validated_data['action']
        allowed = {'APPROVE': ['PENDING'], 'REJECT': ['PENDING'], 'SUSPEND': ['VERIFIED'], 'RESTORE': ['REJECTED', 'SUSPENDED']}
        if item.verification_state not in allowed[action]:
            return Response({'message': 'Invalid business verification transition.'}, status=409)
        if action in ['APPROVE', 'RESTORE'] and not item.legal_name.strip():
            raise serializers.ValidationError('A business legal name is required for verification.')
        item.verification_state = {'APPROVE': 'VERIFIED', 'REJECT': 'REJECTED', 'SUSPEND': 'SUSPENDED', 'RESTORE': 'VERIFIED'}[action]
        item.save(update_fields=['verification_state'])
        audit(request, item, 'BUSINESS_' + action, BusinessSerializer(item).data, serializer.validated_data['reason'])
        return Response(BusinessSerializer(item).data)


class StaffLocations(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'
    serializer_class = LocationSerializer
    pagination_class = Pages

    def get_queryset(self):
        qs = DealerLocation.objects.order_by('pk')
        value = self.request.query_params.get('business')
        if value:
            if not value.isdecimal():
                raise serializers.ValidationError('Expected business ID.')
            qs = qs.filter(business_id=value)
        return qs


class StaffLocationModeration(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'

    @transaction.atomic
    def post(self, request, pk):
        class Input(serializers.Serializer):
            hidden = serializers.BooleanField()
            reason = serializers.CharField(max_length=4000, allow_blank=False)
        serializer = Input(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = get_object_or_404(DealerLocation.objects.select_for_update(), pk=pk)
        item.admin_hidden = serializer.validated_data['hidden']
        item.save(update_fields=['admin_hidden'])
        audit(request, item.business, 'LOCATION_MODERATED', LocationSerializer(item).data, serializer.validated_data['reason'], location=item)
        return Response(LocationSerializer(item).data)


class StaffListings(generics.ListAPIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'
    serializer_class = ListingSerializer
    pagination_class = Pages

    def get_queryset(self):
        return filter_listings(self.request, managed_listings(), staff=True)


def grant_records():
    return AuthorizedDealerGrant.objects.select_related('company__owner_account', 'brand', 'business__account').order_by('pk')


def authorization_filters(request, qs, staff=False):
    for key in ['brand', 'business'] + (['company'] if staff else []):
        value = request.query_params.get(key)
        if value:
            if not value.isdecimal():
                raise serializers.ValidationError({key: 'Expected numeric ID.'})
            qs = qs.filter(**{key + '_id': value})
    active = request.query_params.get('active')
    if active is not None and active != '':
        if active not in ['true', 'false']:
            raise serializers.ValidationError({'active': 'Use true or false.'})
        qs = qs.filter(active=active == 'true')
    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(Q(business__legal_name__icontains=search) | Q(brand__name__icontains=search) | Q(company__legal_name__icontains=search))
    return qs


class CompanyDealerSearch(APIView):
    permission_classes = [IsCompanyAccount]

    def get(self, request):
        company = get_object_or_404(CompanyProfile, owner_account=request.user)
        if not company.can_publish_catalogue:
            raise PermissionDenied('A verified active company is required to search eligible dealers.')
        class DealerIdentity(serializers.ModelSerializer):
            class Meta:
                model = BusinessProfile
                fields = ['id', 'legal_name', 'verification_state']
                read_only_fields = fields
        qs = BusinessProfile.objects.filter(verification_state='VERIFIED', account__access_state='ACTIVE', account__account_type=AccountType.BUSINESS).exclude(account=request.user).order_by('pk')
        search = request.query_params.get('search', '').strip()
        if search:
            match = Q(legal_name__icontains=search)
            if search.isdecimal():
                match |= Q(pk=search)
            qs = qs.filter(match)
        response = page(request, qs, DealerIdentity)
        response['Cache-Control'] = 'private, no-store'
        return response


class StaffAuthorizations(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'REVIEW_BUSINESS'

    def get(self, request):
        response = page(request, authorization_filters(request, grant_records(), staff=True), GrantSerializer)
        response['Cache-Control'] = 'private, no-store'
        return response


class StaffAuthorizationAudit(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'READ_AUDIT'

    def get(self, request):
        class Event(serializers.ModelSerializer):
            class Meta:
                model = DealerAudit
                fields = ['id', 'business', 'grant', 'actor', 'action', 'reason', 'snapshot', 'occurred_at']
                read_only_fields = fields
        qs = DealerAudit.objects.filter(grant__isnull=False, action__in=['DEALER_AUTHORIZATION_GRANTED', 'DEALER_AUTHORIZATION_REVOKED']).order_by('-pk')
        for key, field in [('grant', 'grant_id'), ('company', 'grant__company_id'), ('brand', 'grant__brand_id'), ('business', 'business_id')]:
            value = request.query_params.get(key)
            if value:
                if not value.isdecimal():
                    raise serializers.ValidationError({key: 'Expected numeric ID.'})
                qs = qs.filter(**{field: value})
        response = page(request, qs, Event)
        response['Cache-Control'] = 'private, no-store'
        return response


class StaffListingAudit(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = 'READ_AUDIT'

    def get(self, request):
        class Event(serializers.ModelSerializer):
            class Meta:
                model = DealerAudit
                fields = ['id', 'business', 'location', 'listing', 'actor', 'action', 'reason', 'snapshot', 'occurred_at']
                read_only_fields = fields
        qs = DealerAudit.objects.filter(listing__isnull=False).order_by('-pk')
        for key in ['listing', 'business', 'location']:
            value = request.query_params.get(key)
            if value:
                if not value.isdecimal():
                    raise serializers.ValidationError({key: 'Expected numeric ID.'})
                qs = qs.filter(**{key + '_id': value})
        response = page(request, qs, Event)
        response['Cache-Control'] = 'private, no-store'
        return response
