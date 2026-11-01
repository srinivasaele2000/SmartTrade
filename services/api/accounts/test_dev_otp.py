from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from types import SimpleNamespace
from unittest.mock import patch

from .models import Account, AccountType, StaffState
from .dev_otp import DevelopmentOTPProvider
from .otp import get_otp_provider, OTPProviderUnavailable


@override_settings(DEBUG=True, SMARTTRADE_ENABLE_DEV_OTP=True, SMARTTRADE_ENABLE_DEV_AUTH=False,
                   SMARTTRADE_OTP_PROVIDER='', ALLOWED_HOSTS=['localhost'])
class DevelopmentOTPTests(TestCase):
    def setUp(self):
        self.client = APIClient(HTTP_HOST='localhost')
        self.mobile = '+14155550800'

    def request(self, mobile=None, **headers):
        return self.client.post('/api/v1/auth/otp/request', {'mobile_e164': mobile or self.mobile}, format='json', **headers)

    def login(self, code='anything', **headers):
        return self.client.post('/api/v1/auth/login', {'mobile_e164': self.mobile, 'code': code}, format='json', **headers)

    def test_request_unknown_valid_mobile_without_creation_or_delivery(self):
        response = self.request()
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['authentication_mode'], 'development_otp')
        self.assertEqual(Account.objects.count(), 0)
        self.assertEqual(self.request('invalid').status_code, 400)
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(Account.objects.count(), 0)

    def test_registration_and_any_nonempty_code_for_marketplace_types(self):
        for index, kind in enumerate(('PERSONAL', 'BUSINESS', 'COMPANY')):
            self.mobile = f'+1415555081{index}'
            response = self.client.post('/api/v1/auth/register', {'mobile_e164': self.mobile, 'account_type': kind}, format='json')
            self.assertEqual(response.status_code, 201)
            for code in ('letters', '1', 'arbitrary code'):
                login = self.login(code)
                self.assertEqual(login.status_code, 200)
                self.assertEqual(login.data['authentication_mode'], 'development_otp')
                account = Account.objects.get(pk=login.data['account']['id'])
                self.assertEqual(account.account_type, kind)
                self.assertIsNone(account.mobile_verified_at)
                self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + login.data['access'])
                self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 200)
                self.assertEqual(self.client.get('/api/v1/staff/companies/verification-queue').status_code, 403)
                self.client.credentials()

    def test_empty_code_and_staff_registration_rejected(self):
        Account.objects.create_user(self.mobile, AccountType.PERSONAL)
        for code in ('', '   '):
            self.assertEqual(self.login(code).status_code, 400)
        self.assertEqual(self.client.post('/api/v1/auth/register', {'mobile_e164': '+14155550899', 'account_type': 'STAFF'}, format='json').status_code, 400)

    def test_staff_requires_both_flags_and_designation_and_retains_permissions(self):
        staff = Account.objects.create_user(self.mobile, AccountType.STAFF)
        self.assertEqual(self.login().status_code, 403)
        with override_settings(SMARTTRADE_ENABLE_DEV_AUTH=True, SMARTTRADE_DEV_AUTH_STAFF_ID='999999'):
            self.assertEqual(self.login().status_code, 403)
        with override_settings(SMARTTRADE_ENABLE_DEV_AUTH=True, SMARTTRADE_DEV_AUTH_STAFF_ID=str(staff.pk)):
            login = self.login()
            self.assertEqual(login.status_code, 200)
            self.assertEqual(login.data['account']['staff_profile']['permissions'], [])
            self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + login.data['access'])
            self.assertEqual(self.client.get('/api/v1/staff/companies/verification-queue').status_code, 403)
            with override_settings(SMARTTRADE_ENABLE_DEV_AUTH=False):
                self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
                self.assertEqual(self.client.post('/api/v1/auth/refresh', {'refresh': login.data['refresh']}, format='json').status_code, 401)

    def test_blocked_and_inactive_accounts_rejected(self):
        account = Account.objects.create_user(self.mobile, AccountType.STAFF)
        with override_settings(SMARTTRADE_ENABLE_DEV_AUTH=True, SMARTTRADE_DEV_AUTH_STAFF_ID=str(account.pk)):
            account.access_state = 'BLOCKED'
            account.save()
            self.assertEqual(self.login().status_code, 401)
            account.access_state = 'ACTIVE'
            account.save()
            profile = account.staff_profile
            profile.state = StaffState.DISABLED
            profile.save()
            self.assertEqual(self.login().status_code, 401)

    def test_loopback_origin_and_host_required(self):
        for headers in ({'REMOTE_ADDR': '192.0.2.1', 'HTTP_X_FORWARDED_FOR': '127.0.0.1'}, {'HTTP_ORIGIN': 'https://foreign.example'}, {'HTTP_HOST': 'localhost', 'HTTP_ORIGIN': 'null'}):
            self.assertEqual(self.request(**headers).status_code, 403)
            self.assertEqual(self.login(**headers).status_code, 403)

    def test_disabled_or_production_never_accepts_development_provider(self):
        for values in ({'DEBUG': False}, {'SMARTTRADE_ENABLE_DEV_OTP': False}):
            with override_settings(**values):
                self.assertEqual(self.request().status_code, 503)
                self.assertEqual(self.login().status_code, 503)
                self.assertEqual(self.client.get('/api/v1/auth/otp/request').status_code, 404)
                self.assertFalse(DevelopmentOTPProvider().verify_code(self.mobile, 'any'))
                with override_settings(SMARTTRADE_OTP_PROVIDER='accounts.dev_otp.DevelopmentOTPProvider'):
                    with self.assertRaises(OTPProviderUnavailable):
                        get_otp_provider()

    def test_refresh_logout_and_configuration_revocation(self):
        Account.objects.create_user(self.mobile, AccountType.PERSONAL)
        login = self.login()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + login.data['access'])
        refresh_data = {'refresh': login.data['refresh']}
        self.assertEqual(self.client.post('/api/v1/auth/refresh', refresh_data, format='json').status_code, 200)
        for values in ({'DEBUG': False}, {'SMARTTRADE_ENABLE_DEV_OTP': False}):
            with override_settings(**values):
                self.assertEqual(self.client.get('/api/v1/auth/me').status_code, 401)
                self.assertEqual(self.client.post('/api/v1/auth/refresh', refresh_data, format='json').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/auth/me', REMOTE_ADDR='192.0.2.1').status_code, 401)
        self.assertEqual(self.client.post('/api/v1/auth/logout').status_code, 204)
        self.assertEqual(self.client.post('/api/v1/auth/refresh', refresh_data, format='json').status_code, 401)

    def test_configured_real_provider_is_used_when_simulation_disabled_or_debug_false(self):
        class RealProvider:
            def send_code(self, mobile):
                return True

            def verify_code(self, mobile, code):
                return code == 'provider-validated-test-code'

        Account.objects.create_user(self.mobile, AccountType.PERSONAL)
        for values in ({'DEBUG': False}, {'SMARTTRADE_ENABLE_DEV_OTP': False}):
            with override_settings(**values, SMARTTRADE_OTP_PROVIDER='configured.Provider'):
                with patch('accounts.otp.import_module', return_value=SimpleNamespace(Provider=RealProvider)):
                    self.assertIsInstance(get_otp_provider(), RealProvider)
                    self.assertEqual(self.request().data, {'status': 'accepted'})
                    self.assertEqual(self.login('arbitrary').status_code, 401)
                    login = self.login('provider-validated-test-code')
                    self.assertEqual(login.status_code, 200)
                    self.assertNotIn('authentication_mode', login.data)
                    self.assertTrue(login.data['account']['mobile_verified'])
