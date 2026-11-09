from collections.abc import Mapping

from django.db import transaction
from rest_framework import serializers
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from config.india import INDIAN_PIN_PATTERN, canonical_indian_state
from .models import AccountType, PersonalProfile


def validate_profile_location(attrs, prefix=''):
    pin_field, state_field = prefix + 'pin_code', prefix + 'state'
    pin = attrs.get(pin_field)
    if pin and not INDIAN_PIN_PATTERN.fullmatch(pin):
        raise serializers.ValidationError({pin_field: 'Use a six-digit Indian PIN code.'})
    if attrs.get(state_field):
        state = canonical_indian_state(attrs[state_field])
        if state is None:
            raise serializers.ValidationError({state_field: 'Choose an Indian state or union territory.'})
        attrs[state_field] = state
    return attrs


class PersonalSerializer(serializers.ModelSerializer):
    mobile_e164 = serializers.CharField(source='account.mobile_e164', read_only=True)

    class Meta:
        model = PersonalProfile
        fields = ['mobile_e164', 'full_name', 'occupation', 'pin_code', 'locality', 'district', 'state']

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            return super().to_internal_value(data)
        unexpected = set(data) - (set(self.fields) - {'mobile_e164'})
        if unexpected:
            raise serializers.ValidationError({name: 'Unknown or read-only field.' for name in unexpected})
        return super().to_internal_value(data)

    def validate(self, attrs):
        return validate_profile_location(attrs)


class IsPersonalAccount(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and user.is_active and user.account_type == AccountType.PERSONAL


class PersonalMe(APIView):
    permission_classes = [IsPersonalAccount]

    def get(self, request):
        return Response(PersonalSerializer(request.user.personal_profile).data, headers={'Cache-Control': 'no-store'})

    @transaction.atomic
    def patch(self, request):
        profile = PersonalProfile.objects.select_for_update().get(account=request.user)
        serializer = PersonalSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, headers={'Cache-Control': 'no-store'})
