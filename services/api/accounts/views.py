import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    AccountAccessState, AccountType,
)
from .otp import OTPProviderUnavailable, get_otp_provider
from .dev_otp import DevelopmentOTPProvider, enabled as dev_otp_enabled
from .dev_auth import local_request, enabled as dev_auth_enabled, designated
from .permissions import IsActiveAccount
from .serializers import (
    AccountRegistrationSerializer,
    AccountResponseSerializer,
    LoginSerializer,
    OTPRequestSerializer,
)


logger = logging.getLogger(__name__)
Account = get_user_model()


def error_response(code, detail, http_status):
    return Response({"code": code, "message": detail}, status=http_status)


class AccountRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = AccountRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed.",
                    "field_errors": serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        values = serializer.validated_data
        try:
            with transaction.atomic():
                if Account.objects.filter(mobile_e164=values["mobile_e164"]).exists():
                    return error_response(
                        "MOBILE_ALREADY_REGISTERED",
                        "An account with this mobile number already exists.",
                        status.HTTP_409_CONFLICT,
                    )
                account = Account.objects.create_user(**values)
        except IntegrityError:
            # The database uniqueness constraint handles concurrent registration.
            if Account.objects.filter(mobile_e164=values["mobile_e164"]).exists():
                return error_response(
                    "MOBILE_ALREADY_REGISTERED",
                    "An account with this mobile number already exists.",
                    status.HTTP_409_CONFLICT,
                )
            logger.error("Account registration failed due to a database constraint")
            return error_response(
                "REGISTRATION_FAILED",
                "The account could not be created.",
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "account": AccountResponseSerializer(account).data,
                "authentication": ("Local development OTP is available; phone ownership remains unverified." if dev_otp_enabled() and local_request(request) else "A real OTP provider must verify this number before login."),
            },
            status=status.HTTP_201_CREATED,
        )


class OTPRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if not dev_otp_enabled() or not local_request(request):
            return error_response("DEV_OTP_DISABLED", "Development OTP is disabled or this request is not local.", 404)
        return Response({"enabled": True, "authentication_mode": "development_otp"}, headers={"Cache-Control": "no-store"})

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed.",
                    "field_errors": serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            provider = get_otp_provider()
        except OTPProviderUnavailable:
            provider = None
        if provider is None:
            return error_response(
                "AUTH_PROVIDER_UNAVAILABLE",
                "Phone verification is not configured for this environment.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        development_otp = isinstance(provider, DevelopmentOTPProvider)
        if development_otp and not local_request(request):
            return error_response("DEV_OTP_LOCAL_ONLY", "Development OTP requires a loopback request.", 403)
        mobile = serializer.validated_data["mobile_e164"]
        account = Account.objects.filter(mobile_e164=mobile).first()
        if development_otp:
            provider.send_code(mobile)
            return Response({"status": "accepted", "authentication_mode": "development_otp", "message": "Development only: no SMS sent. Enter any non-empty code. Phone remains unverified."}, status=202, headers={"Cache-Control": "no-store"})
        # Return the same acknowledgement for unknown or blocked numbers.
        if account is not None and account.is_active:
            try:
                sent = provider.send_code(mobile)
            except Exception:
                logger.warning("Configured OTP provider failed to send a code")
                sent = False
            if sent is not None and sent is not True:
                # Keep delivery failures indistinguishable from unknown/blocked numbers.
                logger.warning("Configured OTP provider did not accept a code request")
        return Response({"status": "accepted"}, status=status.HTTP_202_ACCEPTED)


class AccountLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed.",
                    "field_errors": serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            provider = get_otp_provider()
        except OTPProviderUnavailable:
            provider = None
        if provider is None:
            return error_response(
                "AUTH_PROVIDER_UNAVAILABLE",
                "Phone verification is not configured for this environment.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        development_otp = isinstance(provider, DevelopmentOTPProvider)
        if development_otp and not local_request(request):
            return error_response("DEV_OTP_LOCAL_ONLY", "Development OTP requires a loopback request.", 403)
        mobile = serializer.validated_data["mobile_e164"]
        try:
            verified = provider.verify_code(mobile, serializer.validated_data["code"])
        except Exception:
            logger.warning("Configured OTP provider failed to verify a code")
            return error_response(
                "AUTH_PROVIDER_UNAVAILABLE",
                "Phone verification is temporarily unavailable.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if verified is not True:
            return error_response(
                "INVALID_CREDENTIALS",
                "The mobile number or verification code is invalid.",
                status.HTTP_401_UNAUTHORIZED,
            )

        account = Account.objects.filter(mobile_e164=mobile).first()
        if account is None:
            if development_otp:
                return error_response("ACCOUNT_NOT_REGISTERED", "Register a PERSONAL, BUSINESS or COMPANY account before development login. Staff provisioning is separate.", 401)
            return error_response(
                "INVALID_CREDENTIALS",
                "The mobile number or verification code is invalid.",
                status.HTTP_401_UNAUTHORIZED,
            )
        if account.access_state != AccountAccessState.ACTIVE or not account.is_active:
            return error_response(
                "ACCOUNT_BLOCKED",
                "This account cannot sign in. Contact support or submit a review request.",
                status.HTTP_401_UNAUTHORIZED,
            )

        if development_otp:
            if account.account_type == AccountType.STAFF and not (dev_auth_enabled() and designated(account)):
                return error_response("DEV_AUTH_UNAUTHORIZED", "Development staff login requires the enabled designated staff identity.", 403)
            return token_response(account, development_otp=True)
        account.mark_mobile_verified()
        return token_response(account)


def token_response(account, *, development=False, development_otp=False):
    refresh = RefreshToken.for_user(account)
    refresh["token_version"] = account.token_version
    refresh["account_type"] = account.account_type
    if development:
        refresh["dev_auth"] = True
    if development_otp:
        refresh["dev_otp"] = True
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "expires_in": int(api_settings.ACCESS_TOKEN_LIFETIME.total_seconds()),
            **({"authentication_mode": "development_otp"} if development_otp else {}),
            "account": AccountResponseSerializer(account).data,
        },
        status=status.HTTP_200_OK,
        headers={"Cache-Control": "no-store"} if development or development_otp else None,
    )

class AccountTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        try:
            token = self.token_class(attrs["refresh"])
            user_id = token.get(api_settings.USER_ID_CLAIM)
            account = Account.objects.get(**{api_settings.USER_ID_FIELD: user_id})
        except (TokenError, Account.DoesNotExist, KeyError, TypeError, ValueError) as exc:
            raise serializers.ValidationError("Token is invalid or expired.") from exc

        if (
            not account.is_active
            or token.get("token_version") != account.token_version
        ):
            raise serializers.ValidationError("Token is invalid or expired.")
        from .dev_auth import development_token_allowed
        from .dev_auth import local_request
        if (token.get("dev_auth") or token.get("dev_otp")) and not local_request(self.context["request"]):
            raise serializers.ValidationError("Token is invalid or expired.")
        if not development_token_allowed(account, token):
            raise serializers.ValidationError("Token is invalid or expired.")
        try:
            return super().validate(attrs)
        except (InvalidToken, TokenError) as exc:
            raise serializers.ValidationError("Token is invalid or expired.") from exc


class AccountTokenRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = AccountTokenRefreshSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error_response(
                "INVALID_TOKEN",
                "Token is invalid or expired.",
                status.HTTP_401_UNAUTHORIZED,
            )
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class AccountLogoutView(APIView):
    permission_classes = [IsActiveAccount]

    def post(self, request):
        request.user.invalidate_tokens()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountMeView(APIView):
    permission_classes = [IsActiveAccount]

    def get(self, request):
        return Response({"account": AccountResponseSerializer(request.user).data})
