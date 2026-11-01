from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import (Account, AccountType, StaffState, StaffRole, StaffPermission,
                     StaffRolePermission, StaffRoleAssignment)


@override_settings(DEBUG=True, SMARTTRADE_ENABLE_DEV_AUTH=True, ALLOWED_HOSTS=['localhost', '127.0.0.1', 'testserver'])
class DevelopmentAuthenticationTests(TestCase):
    def setUp(self):
        self.staff = Account.objects.create_user('+14155550900', AccountType.STAFF)
        self.settings_override = override_settings(SMARTTRADE_DEV_AUTH_STAFF_ID=str(self.staff.pk))
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.client = APIClient(HTTP_HOST='localhost')

    def login(self, **extra):
        return self.client.post('/api/v1/auth/dev-login', {}, format='json', **extra)

    def authorize(self, response):
        self.assertEqual(response.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + response.data['access'])

    def test_existing_staff_login_does_not_verify_phone_or_create_account(self):
        self.authorize(self.login())
        self.assertEqual(Account.objects.count(), 1)
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.mobile_verified_at)
        self.assertFalse(self.staff.has_usable_password())
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 200)

    @override_settings(SMARTTRADE_ENABLE_DEV_AUTH=False)
    def test_disabled(self):
        self.assertEqual(self.login().status_code, 404)
        self.assertEqual(self.client.get('/api/v1/auth/dev-login').status_code, 404)

    @override_settings(DEBUG=False)
    def test_production_even_with_flag(self):
        self.assertEqual(self.login().status_code, 404)

    def test_non_loopback_and_forwarded_header_cannot_bypass(self):
        self.assertEqual(self.login(REMOTE_ADDR='192.0.2.1', HTTP_X_FORWARDED_FOR='127.0.0.1').status_code, 404)
        self.assertEqual(self.login(HTTP_ORIGIN='https://untrusted.example').status_code, 404)
        self.assertEqual(self.login(HTTP_ORIGIN='null').status_code, 404)
        self.assertEqual(self.login(HTTP_HOST='testserver').status_code, 404)
        self.assertEqual(self.login(REMOTE_ADDR='::1', HTTP_ORIGIN='http://localhost:5173').status_code, 200)

    def test_client_cannot_select_account_and_requires_json(self):
        self.assertEqual(self.client.post('/api/v1/auth/dev-login', {'id': self.staff.pk}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/v1/auth/dev-login', {}).status_code, 400)

    def test_non_staff_missing_and_invalid_designation(self):
        other = Account.objects.create_user('+14155550901', AccountType.PERSONAL)
        for value in (str(other.pk), '', 'invalid', '9999999999999999999999999999'):
            with override_settings(SMARTTRADE_DEV_AUTH_STAFF_ID=value):
                self.assertEqual(self.login().status_code, 403)

    def test_blocked_and_disabled_staff(self):
        self.staff.access_state = 'BLOCKED'
        self.staff.save()
        self.assertEqual(self.login().status_code, 403)
        self.staff.access_state = 'ACTIVE'
        self.staff.save()
        profile = self.staff.staff_profile
        profile.state = StaffState.DISABLED
        profile.save()
        self.assertEqual(self.login().status_code, 403)

    def test_actual_staff_permissions_and_revocation(self):
        self.authorize(self.login())
        path = '/api/v1/staff/companies/verification-queue'
        self.assertEqual(self.client.get(path).status_code, 403)
        role = StaffRole.objects.create(code='REVIEWER')
        permission = StaffPermission.objects.create(code='REVIEW_COMPANY')
        StaffRolePermission.objects.create(role=role, permission=permission)
        assignment = StaffRoleAssignment.objects.create(staff_account=self.staff, role=role, grant_source='BOOTSTRAP')
        me = self.client.get('/api/v1/auth/me')
        self.assertEqual(me.data['account']['staff_profile']['permissions'], ['REVIEW_COMPANY'])
        self.assertEqual(self.client.get(path).status_code, 200)
        from django.utils import timezone
        assignment.revoked_at = timezone.now()
        assignment.save()
        self.assertEqual(self.client.get(path).status_code, 403)

    def test_refresh_logout_and_version_invalidation(self):
        login = self.login()
        self.authorize(login)
        refreshed = self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json')
        self.assertEqual(refreshed.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + refreshed.data['access'])
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/auth/logout').status_code, 204)
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
        self.assertEqual(self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json').status_code, 401)

    def test_disabled_staff_rejects_previously_issued_development_tokens(self):
        login = self.login()
        self.authorize(login)
        profile = self.staff.staff_profile
        profile.state = StaffState.DISABLED
        profile.save()
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
        self.assertEqual(self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json').status_code, 401)

    def test_development_tokens_fail_closed_after_configuration_or_state_change(self):
        login = self.login()
        self.authorize(login)
        for settings in ({'DEBUG': False}, {'SMARTTRADE_ENABLE_DEV_AUTH': False}, {'SMARTTRADE_DEV_AUTH_STAFF_ID': ''}):
            with override_settings(**settings):
                self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
                self.assertEqual(self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/auth/me', REMOTE_ADDR='192.0.2.1').status_code, 401)
        self.assertEqual(self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json', REMOTE_ADDR='192.0.2.1').status_code, 401)
        self.staff.access_state = 'BLOCKED'
        self.staff.save()
        self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)

    @override_settings(SMARTTRADE_OTP_PROVIDER='')
    def test_normal_otp_remains_unavailable(self):
        for path, data in (('otp/request', {'mobile_e164': self.staff.mobile_e164}), ('login', {'mobile_e164': self.staff.mobile_e164, 'code': 'not-a-real-code'})):
            self.assertEqual(self.client.post('/api/v1/auth/' + path, data, format='json').status_code, 503)
