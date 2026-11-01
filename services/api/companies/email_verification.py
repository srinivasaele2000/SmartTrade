from importlib import import_module
from hashlib import sha256

from accounts.dev_auth import local_request

from django.conf import settings


class CompanyEmailProviderUnavailable(Exception):
    """Raised when no real company email-verification provider is configured."""


def get_company_email_provider():
    provider_path = getattr(settings, "SMARTTRADE_COMPANY_EMAIL_PROVIDER", "")
    if not provider_path:
        return None
    try:
        module_path, class_name = provider_path.rsplit(".", 1)
        provider = getattr(import_module(module_path), class_name)()
        if not callable(getattr(provider, "send_code", None)) or not callable(
            getattr(provider, "verify_code", None)
        ):
            raise TypeError("The email provider does not implement the required interface.")
        return provider
    except Exception as exc:
        raise CompanyEmailProviderUnavailable from exc


def development_enabled(request=None):
    return bool(settings.DEBUG and getattr(settings, "SMARTTRADE_ENABLE_DEV_EMAIL", False)
                and request is not None and local_request(request))


def email_fingerprint(company):
    return sha256(company.company_email.casefold().encode()).hexdigest()


def development_verified(company, request):
    if not development_enabled(request):
        return False
    event = company.audit_events.filter(action__in=["COMPANY_EMAIL_DEV_VERIFIED", "COMPANY_EMAIL_VERIFICATION_RESET"]).order_by("-pk").first()
    return bool(event and event.action == "COMPANY_EMAIL_DEV_VERIFIED"
                and event.details.get("email_fingerprint") == email_fingerprint(company))


def email_ready(company, request):
    return company.email_verified_at is not None or development_verified(company, request)
