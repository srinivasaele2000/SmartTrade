from math import asin, cos, isfinite, radians, sin, sqrt

from django.db.models import Count, OuterRef, Prefetch, Q, Subquery, prefetch_related_objects
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.dealer_gate import WORKER_CONTACT_TARGET
from catalogue.views import Pages, eligible_products
from config.india import INDIAN_PIN_PATTERN
from .models import DealerLocation, TradeWorkerContact
from .views import eligible_listings


def distance_km(lat, lng, branch_lat, branch_lng):
    a, b = radians(lat), radians(float(branch_lat))
    h = sin((b - a) / 2) ** 2 + cos(a) * cos(b) * sin(radians(float(branch_lng) - lng) / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(min(1, h)))


class NearbyInput(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lng = serializers.FloatField(min_value=-180, max_value=180, required=False)
    radius_km = serializers.FloatField(min_value=1, max_value=200, default=25)
    area = serializers.CharField(max_length=120, required=False)
    city = serializers.CharField(max_length=120, required=False)
    pincode = serializers.RegexField(INDIAN_PIN_PATTERN, required=False)
    q = serializers.CharField(max_length=120, required=False)
    brand_id = serializers.IntegerField(min_value=1, required=False)
    category_id = serializers.IntegerField(min_value=1, required=False)

    def validate(self, values):
        if any(not isfinite(values[k]) for k in ('lat', 'lng', 'radius_km') if k in values):
            raise serializers.ValidationError('Coordinates and radius must be finite numbers.')
        if ('lat' in values) != ('lng' in values):
            raise serializers.ValidationError('Provide both latitude and longitude.')
        if not any(key in values for key in ('lat', 'city', 'area', 'pincode')):
            raise serializers.ValidationError('Choose a location, city, area or PIN code.')
        return values


def discoverable_branches():
    workers = TradeWorkerContact.objects.filter(business_id=OuterRef('business_id')).order_by().values('business_id')
    return DealerLocation.objects.filter(
        active=True, admin_hidden=False, visibility_state='VISIBLE',
        business__verification_state='VERIFIED', business__account__access_state='ACTIVE',
        business__contacts_submitted_at__isnull=False,
    ).alias(worker_count=Subquery(workers.annotate(total=Count('pk')).values('total'))).filter(
        worker_count__gte=WORKER_CONTACT_TARGET,
    ).select_related('business')


def public_offer(offer):
    return {
        'listing': offer.pk, 'product': offer.product_id,
        'name': offer.product.name, 'sku': offer.variant.sku if offer.variant else None,
        'selling_price': str(offer.selling_price), 'stock_status': offer.stock_status,
    }


class NearbyBranchCatalogue(APIView):
    permission_classes = [AllowAny]

    def get(self, request, branch_id):
        branch = get_object_or_404(discoverable_branches(), pk=branch_id)
        listings = eligible_listings().filter(location=branch).exclude(stock_status='OUT_OF_STOCK')
        paginator = Pages()
        return paginator.get_paginated_response([
            public_offer(offer) for offer in paginator.paginate_queryset(listings, request)
        ])


class NearbyDealers(APIView):
    permission_classes = [AllowAny]

    def get(self, request, item_id=None):
        inputs = NearbyInput(data=request.query_params)
        inputs.is_valid(raise_exception=True)
        values = inputs.validated_data
        branches = discoverable_branches()
        for key in ('area', 'city'):
            if key in values:
                for term in (part.strip() for part in values[key].split(',')):
                    if term:
                        branches = branches.filter(Q(locality__icontains=term) | Q(district__icontains=term) | Q(address__icontains=term))
        if 'pincode' in values:
            branches = branches.filter(pin_code=values['pincode'])

        listings = eligible_listings().exclude(stock_status='OUT_OF_STOCK').order_by('pk')
        if item_id is not None:
            get_object_or_404(eligible_products(), pk=item_id)
            listings = listings.filter(product_id=item_id)
        for key, field in (('brand_id', 'product__brand_category__brand_id'),
                           ('category_id', 'product__brand_category__category_id')):
            if key in values:
                listings = listings.filter(**{field: values[key]})

        gps = 'lat' in values
        text_location = any(key in values for key in ('area', 'city', 'pincode'))
        if gps and not text_location:
            branches = branches.filter(latitude__isnull=False, longitude__isnull=False)
        terms = values.get('q', '').casefold().split()
        nearby = []
        for branch in branches:
            distance = None
            if gps and branch.latitude is not None and branch.longitude is not None:
                distance = distance_km(values['lat'], values['lng'], branch.latitude, branch.longitude)
                if distance > values['radius_km']:
                    continue
            elif gps and not text_location:
                continue
            nearby.append((distance, branch))
        prefetch_related_objects([branch for _, branch in nearby], Prefetch(
            'listings', queryset=listings.select_related('product__brand_category__category'),
            to_attr='discovery_listings',
        ))
        matches = []
        for distance, branch in nearby:
            offers = branch.discovery_listings
            def matches_search(offer):
                product = offer.product
                association = product.brand_category
                haystack = ' '.join((branch.business.legal_name, product.name, product.code,
                                     association.brand.name, association.category.name)).casefold()
                return all(term in haystack for term in terms)
            matching = [offer for offer in offers if matches_search(offer)]
            if not matching and (item_id is not None or 'brand_id' in values or 'category_id' in values
                                 or (terms and not all(term in branch.business.legal_name.casefold() for term in terms))):
                continue
            matches.append((distance, branch, offers, matching))
        matches.sort(key=lambda entry: (entry[0] is None, entry[0] or 0, entry[1].pk))
        paginator = Pages()
        results = []
        for distance, branch, offers, matching in paginator.paginate_queryset(matches, request):
            results.append({
                'id': branch.pk, 'business_name': branch.business.legal_name, 'branch_name': branch.branch_name,
                'locality': branch.locality, 'city': branch.district, 'pincode': branch.pin_code,
                'latitude': branch.latitude, 'longitude': branch.longitude,
                'distance_km': round(distance, 1) if distance is not None else None,
                'is_verified': True,
                'brands': sorted({offer.product.brand_category.brand.name for offer in offers}),
                'category_count': len({offer.product.brand_category.category_id for offer in offers}),
                'catalogue_item_count': len({offer.product_id for offer in offers}),
                'matched_items_count': len({offer.product_id for offer in matching}) if 'q' in values else None,
                'offer': public_offer(matching[0]) if matching else None,
            })
        return paginator.get_paginated_response(results)
