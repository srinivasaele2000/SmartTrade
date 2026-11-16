from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from rest_framework import generics, serializers

from accounts.dealer_gate import DealerOnboardingRequired, dealer_contacts_complete
from catalogue.serializers import StrictSerializer
from catalogue.views import Pages
from .models import DealerCustomItem
from .views import IsBusiness


class CustomItemFields(StrictSerializer):
    list_price_per_unit = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))

    class Meta:
        model = DealerCustomItem
        fields = ('id', 'product_name', 'product_code', 'hsn_sac_code', 'list_price_per_unit', 'updated_at')


class CustomItemAccess:
    permission_classes = [IsBusiness]
    serializer_class = CustomItemFields

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response

    def get_queryset(self):
        if not dealer_contacts_complete(self.request.user):
            raise DealerOnboardingRequired()
        return DealerCustomItem.objects.filter(dealer__account=self.request.user, is_active=True).order_by('-updated_at', '-pk')


class GeneralItems(CustomItemAccess, generics.ListCreateAPIView):
    pagination_class = Pages

    def filter_queryset(self, queryset):
        for term in self.request.query_params.get('q', '').strip()[:200].split():
            queryset = queryset.filter(Q(product_name__icontains=term) | Q(product_code__icontains=term) | Q(hsn_sac_code__icontains=term))
        return queryset

    def perform_create(self, serializer):
        self.get_queryset()
        serializer.save(dealer=self.request.user.business_profile)


class GeneralItemDetail(CustomItemAccess, generics.UpdateAPIView, generics.DestroyAPIView):
    http_method_names = ['patch', 'delete', 'options']

    def get_queryset(self):
        return super().get_queryset().select_for_update(of=('self',))

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        return super().patch(request, *args, **kwargs)

    @transaction.atomic
    def delete(self, request, *args, **kwargs):
        return super().delete(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
