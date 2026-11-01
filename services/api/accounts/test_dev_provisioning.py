from io import StringIO
from unittest.mock import patch, Mock

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from .models import Account, AccountType, StaffRoleAssignment
from .management.commands.provision_dev_admin import assert_local_database, DEVELOPMENT_MOBILE


class DevelopmentProvisioningTests(TestCase):
    def provision(self):
        # The actual target guard is tested separately; all writes here are in
        # Django's disposable test database, never smarttrade_dev.
        with patch('accounts.management.commands.provision_dev_admin.assert_local_database'):
            call_command('provision_dev_admin', stdout=StringIO())

    def test_idempotent_and_preserves_bootstrap_permissions(self):
        self.provision()
        self.provision()
        self.assertEqual(Account.objects.count(), 1)
        account = Account.objects.get(account_type=AccountType.STAFF)
        self.assertTrue(account.is_active)
        self.assertIsNone(account.mobile_verified_at)
        self.assertEqual(StaffRoleAssignment.objects.filter(staff_account=account, role__code='PLATFORM_ADMIN').count(), 1)

    def test_collision_is_never_promoted(self):
        Account.objects.create_user(DEVELOPMENT_MOBILE, AccountType.PERSONAL)
        with self.assertRaises(CommandError):
            self.provision()
        self.assertEqual(StaffRoleAssignment.objects.count(), 0)

    def test_unrelated_staff_prevents_provisioning(self):
        Account.objects.create_user('+12025550101', AccountType.STAFF)
        with self.assertRaises(CommandError):
            self.provision()
        self.assertEqual(Account.objects.count(), 1)

    @override_settings(DEBUG=False)
    def test_production_settings_rejected_before_database_access(self):
        with self.assertRaises(CommandError):
            assert_local_database()

    @override_settings(DEBUG=True, SMARTTRADE_ENABLE_DEV_AUTH=True, SMARTTRADE_ENABLE_DEV_OTP=True, SMARTTRADE_OTP_PROVIDER='')
    def test_actual_database_and_role_are_checked(self):
        connection = Mock(vendor='postgresql', settings_dict={'HOST': '127.0.0.1'})
        connection.cursor.return_value.__enter__ = Mock(return_value=Mock(fetchone=Mock(return_value=('other_database', 'smarttrade_app'))))
        connection.cursor.return_value.__exit__ = Mock(return_value=False)
        with patch('accounts.management.commands.provision_dev_admin.connection', connection):
            with self.assertRaises(CommandError):
                assert_local_database()

    def test_normal_bootstrap_still_validates_and_refuses_duplicate(self):
        with patch('accounts.management.commands.bootstrap_superadmin.getpass', return_value=DEVELOPMENT_MOBILE):
            call_command('bootstrap_superadmin', stdout=StringIO())
            with self.assertRaises(CommandError):
                call_command('bootstrap_superadmin', stdout=StringIO())
        self.assertEqual(Account.objects.count(), 1)
