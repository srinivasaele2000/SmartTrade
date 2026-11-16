from rest_framework.exceptions import PermissionDenied

from .models import AccountType, BusinessProfile


WORKER_CONTACT_TARGET = 10


class DealerOnboardingRequired(PermissionDenied):
    default_code = 'ONBOARDING_STEP_2_REQUIRED'
    default_detail = 'Complete dealer onboarding Step 2 (10 worker contacts) before accessing this module.'


def dealer_contacts_complete(account):
    profile = BusinessProfile.objects.filter(
        account=account, contacts_submitted_at__isnull=False,
    ).first()
    return profile is not None and profile.trade_contacts.count() >= WORKER_CONTACT_TARGET


def enforce_dealer_gate(request, account):
    if account.account_type != AccountType.BUSINESS or not account.is_active:
        return
    path = request.path_info.rstrip('/')
    if path in {'/api/v1/auth/me', '/api/v1/auth/logout'}:
        return
    if path == '/api/v1/dealers/contacts/batch' and request.method == 'POST':
        return
    if path == '/api/v1/businesses/me/trade-contacts' and request.method == 'GET':
        return
    if not dealer_contacts_complete(account):
        raise DealerOnboardingRequired()
