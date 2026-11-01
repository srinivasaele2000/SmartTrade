from importlib import import_module

from django.conf import settings


class OTPProviderUnavailable(Exception):
    """Raised when no real OTP provider is configured or usable."""


def get_otp_provider():
    from .dev_otp import DevelopmentOTPProvider, enabled
    if enabled():
        return DevelopmentOTPProvider()
    provider_path = getattr(settings, "SMARTTRADE_OTP_PROVIDER", "")
    if not provider_path:
        return None

    try:
        module_path, class_name = provider_path.rsplit(".", 1)
        provider_class = getattr(import_module(module_path), class_name)
        # The simulation cannot be enabled by pointing the production adapter
        # setting at its class (or an alias/subclass).
        if issubclass(provider_class, DevelopmentOTPProvider):
            raise OTPProviderUnavailable
        return provider_class()
    except Exception as exc:
        raise OTPProviderUnavailable from exc
