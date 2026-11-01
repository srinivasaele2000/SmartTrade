"""Local simulation only. Never delivers, stores, or verifies a real OTP."""
from django.conf import settings

from .serializers import E164_PATTERN


def enabled():
    return bool(settings.DEBUG and getattr(settings, 'SMARTTRADE_ENABLE_DEV_OTP', False))


class DevelopmentOTPProvider:
    def send_code(self, mobile):
        return bool(enabled() and E164_PATTERN.fullmatch(mobile))

    def verify_code(self, mobile, code):
        return bool(enabled() and E164_PATTERN.fullmatch(mobile) and str(code).strip())
