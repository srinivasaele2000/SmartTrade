"""Explicit local development boundary. No OTP or staff provisioning occurs here."""
from ipaddress import ip_address
from urllib.parse import urlsplit

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Account, AccountType


def enabled():
    return bool(settings.DEBUG and settings.SMARTTRADE_ENABLE_DEV_AUTH)


def designated(account):
    return (
        str(account.pk) == str(settings.SMARTTRADE_DEV_AUTH_STAFF_ID)
        and account.account_type == AccountType.STAFF
        and account.is_active
    )


def development_token_allowed(account, token):
    if token.get("dev_otp"):
        from .dev_otp import enabled as otp_enabled
        return otp_enabled() and account.is_active and (account.account_type != AccountType.STAFF or (enabled() and designated(account)))
    return not token.get("dev_auth") or (enabled() and designated(account))


def loopback(value):
    if value == "localhost":
        return True
    try:
        return ip_address(value).is_loopback
    except ValueError:
        return False


def local_request(request):
    # Trust the socket peer, never X-Forwarded-For. Do not publish this route
    # through a reverse proxy, tunnel, or forwarded development port.
    if not loopback(request.META.get("REMOTE_ADDR", "")):
        return False
    try:
        if not loopback(urlsplit("//" + request.get_host()).hostname or ""):
            return False
        origin = request.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not loopback(parsed.hostname or ""):
                return False
    except ValueError:
        return False
    return True


class DevelopmentLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def available(self, request):
        return enabled() and local_request(request)

    def get(self, request):
        if not self.available(request):
            return Response({"code": "NOT_FOUND"}, status=404)
        return Response({"enabled": True}, headers={"Cache-Control": "no-store"})

    def post(self, request):
        if not self.available(request):
            return Response({"code": "NOT_FOUND"}, status=404)
        if request.content_type != "application/json" or request.data != {}:
            return Response({"message": "Send an empty JSON object; account selection is server-side."}, status=400)
        staff_id = str(settings.SMARTTRADE_DEV_AUTH_STAFF_ID)
        account = Account.objects.filter(pk=int(staff_id)).first() if staff_id.isdecimal() and len(staff_id) < 19 else None
        if account is None or not designated(account):
            return Response({"code": "DEV_AUTH_UNAUTHORIZED", "message": "No eligible designated development staff account is configured."}, status=403)
        from .views import token_response
        response = token_response(account, development=True)
        response["Cache-Control"] = "no-store"
        return response
