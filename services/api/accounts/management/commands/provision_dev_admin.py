"""Non-interactive, guarded wrapper around the normal first-admin bootstrap."""
from io import StringIO

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from accounts.models import Account, AccountType, StaffRoleAssignment
from .bootstrap_superadmin import Command as BootstrapCommand, INITIAL_ADMIN_PERMISSIONS

# NANPA reserved fictitious, non-working range; never send SMS to this identity.
# https://nanpa.com/numbering/555-line-numbers
DEVELOPMENT_MOBILE = '+12025550100'


def assert_local_database():
    if not (settings.DEBUG and settings.SMARTTRADE_ENABLE_DEV_AUTH
            and settings.SMARTTRADE_ENABLE_DEV_OTP and not settings.SMARTTRADE_OTP_PROVIDER):
        raise CommandError('Requires DEBUG, both development authentication flags, and no real OTP provider.')
    config = connection.settings_dict
    if connection.vendor != 'postgresql' or config['HOST'] != '127.0.0.1':
        raise CommandError('Requires the confirmed loopback PostgreSQL development database.')
    with connection.cursor() as cursor:
        cursor.execute('SELECT current_database(), current_user')
        if cursor.fetchone() != ('smarttrade_dev', 'smarttrade_app'):
            raise CommandError('Requires smarttrade_dev and smarttrade_app; no changes made.')


class Command(BaseCommand):
    help = 'Idempotently provision only the dedicated local development administrator.'

    def handle(self, *args, **options):
        assert_local_database()
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(731884120)')
            account = Account.objects.filter(mobile_e164=DEVELOPMENT_MOBILE).first()
            if account is None:
                if Account.objects.filter(account_type=AccountType.STAFF).exists():
                    raise CommandError('Other staff identities exist; refusing automatic provisioning.')
                account = BootstrapCommand(stdout=StringIO()).provision(DEVELOPMENT_MOBILE)
            if account.account_type != AccountType.STAFF or not account.is_active or account.mobile_verified_at is not None:
                raise CommandError('Existing development identity is not eligible; refusing to alter it.')
            assignment = StaffRoleAssignment.objects.filter(
                staff_account=account, role__code='PLATFORM_ADMIN', revoked_at__isnull=True,
                grant_source='BOOTSTRAP', granted_by__isnull=True,
            ).first()
            if not assignment or set(assignment.role.permissions.values_list('code', flat=True)) != set(INITIAL_ADMIN_PERMISSIONS):
                raise CommandError('Unexpected development role configuration; refusing to alter it.')
        self.stdout.write('Dedicated development administrator is provisioned and validated. No identity values displayed.')
