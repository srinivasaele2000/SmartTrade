import re

from rest_framework import serializers

from .models import AccountType


E164_PATTERN = re.compile(r"^\+[1-9][0-9]{1,14}$")
MARKETPLACE_ACCOUNT_TYPES = (
    (AccountType.PERSONAL, "Personal"),
    (AccountType.BUSINESS, "Business"),
    (AccountType.COMPANY, "Company"),
)


class AccountRegistrationSerializer(serializers.Serializer):
    mobile_e164 = serializers.CharField(max_length=16)
    account_type = serializers.ChoiceField(choices=MARKETPLACE_ACCOUNT_TYPES)

    def validate_mobile_e164(self, value):
        if not E164_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                "Use a complete E.164 mobile number, including the country code."
            )
        return value


class OTPRequestSerializer(serializers.Serializer):
    mobile_e164 = serializers.CharField(max_length=16)

    def validate_mobile_e164(self, value):
        if not E164_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                "Use a complete E.164 mobile number, including the country code."
            )
        return value


class LoginSerializer(OTPRequestSerializer):
    code = serializers.CharField(write_only=True, trim_whitespace=True, max_length=256)

    def validate_code(self, value):
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value


class AccountResponseSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    mobile_e164 = serializers.CharField()
    account_type = serializers.CharField()
    access_state = serializers.CharField()
    mobile_verified = serializers.SerializerMethodField()
    staff_profile = serializers.SerializerMethodField()

    def get_staff_profile(self, instance):
        if instance.account_type != AccountType.STAFF:
            return None
        assignments = instance.staff_role_assignments.filter(revoked_at__isnull=True)
        return {
            "state": instance.staff_profile.state,
            "roles": list(assignments.values_list("role__code", flat=True).distinct()),
            "permissions": sorted(set(assignments.exclude(role__permissions__code=None).values_list("role__permissions__code", flat=True))),
        }


    def get_mobile_verified(self, instance):
        return instance.mobile_verified_at is not None
