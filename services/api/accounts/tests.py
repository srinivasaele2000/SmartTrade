from unittest import skipUnless
from unittest.mock import Mock, patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    Account,
    AccountAccessState,
    AccountType,
    BusinessProfile,
    StaffProfile,
    StaffState,
)


def create_account(mobile, account_type=AccountType.PERSONAL, **fields):
    return Account.objects.create_user(
        mobile_e164=mobile,
        account_type=account_type,
        **fields,
    )


class AccountModelTests(TestCase):
    def test_mobile_number_is_unique_across_account_types(self):
        create_account("+14155550101", AccountType.PERSONAL)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                create_account("+14155550101", AccountType.BUSINESS)

    def test_account_type_cannot_be_changed(self):
        account = create_account("+14155550102")
        account.account_type = AccountType.COMPANY
        with self.assertRaises(ValidationError):
            account.save()
        account.refresh_from_db()
        self.assertEqual(account.account_type, AccountType.PERSONAL)

    @skipUnless(
        connection.vendor == "postgresql",
        "requires DB_ENGINE=postgresql to exercise the account-type trigger",
    )
    def test_database_rejects_direct_account_type_update(self):
        account = create_account("+14155550104")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Account.objects.filter(pk=account.pk).update(
                    account_type=AccountType.COMPANY,
                )

    def test_blocking_account_invalidates_existing_tokens(self):
        account = create_account("+14155550103")
        old_version = account.token_version
        account.access_state = AccountAccessState.BLOCKED
        account.save()
        self.assertEqual(account.token_version, old_version + 1)


@skipUnless(
    connection.vendor == "postgresql",
    "requires DB_ENGINE=postgresql to exercise deferred subtype triggers",
)
class AccountSubtypeConstraintPostgreSQLTests(TransactionTestCase):
    def test_account_requires_exactly_one_matching_subtype(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Account.objects.create(
                    mobile_e164="+14155550130",
                    account_type=AccountType.PERSONAL,
                )

    def test_account_cannot_have_a_second_subtype_profile(self):
        account = create_account("+14155550131", AccountType.PERSONAL)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                BusinessProfile.objects.create(account=account)


class RegistrationAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_registration_creates_pending_profile_without_claiming_verification(self):
        response = self.client.post(
            "/api/v1/auth/register",
            {"mobile_e164": "+14155550110", "account_type": "BUSINESS"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        account = Account.objects.get(mobile_e164="+14155550110")
        self.assertIsNone(account.mobile_verified_at)
        self.assertTrue(hasattr(account, "business_profile"))
        self.assertEqual(response.data["account"]["mobile_verified"], False)
        self.assertNotIn("access", response.data)
        self.assertFalse(account.has_usable_password())

    def test_registration_rejects_non_e164_mobile(self):
        response = self.client.post(
            "/api/v1/auth/register",
            {"mobile_e164": "4155550111", "account_type": "PERSONAL"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Account.objects.exists())

    def test_registration_rejects_staff_self_signup(self):
        response = self.client.post(
            "/api/v1/auth/register",
            {"mobile_e164": "+14155550111", "account_type": "STAFF"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Account.objects.exists())

    def test_registration_returns_conflict_for_duplicate_mobile(self):
        create_account("+14155550112", AccountType.PERSONAL)
        response = self.client.post(
            "/api/v1/auth/register",
            {"mobile_e164": "+14155550112", "account_type": "COMPANY"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "MOBILE_ALREADY_REGISTERED")


class AuthenticationAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.account = create_account("+14155550120")

    @override_settings(SMARTTRADE_OTP_PROVIDER="")
    def test_login_fails_closed_when_real_provider_is_not_configured(self):
        response = self.client.post(
            "/api/v1/auth/login",
            {"mobile_e164": self.account.mobile_e164, "code": "123456"},
            format="json",
        )
        self.account.refresh_from_db()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["code"], "AUTH_PROVIDER_UNAVAILABLE")
        self.assertIsNone(self.account.mobile_verified_at)

    @override_settings(SMARTTRADE_OTP_PROVIDER="")
    def test_otp_request_fails_closed_when_provider_is_missing(self):
        response = self.client.post(
            "/api/v1/auth/otp/request",
            {"mobile_e164": self.account.mobile_e164},
            format="json",
        )
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(Account.objects.get(pk=self.account.pk).mobile_verified_at)

    @patch("accounts.views.get_otp_provider")
    def test_otp_delivery_failure_does_not_disclose_account_state(self, get_provider):
        provider = Mock()
        provider.send_code.side_effect = RuntimeError("provider details are private")
        get_provider.return_value = provider

        response = self.client.post(
            "/api/v1/auth/otp/request",
            {"mobile_e164": self.account.mobile_e164},
            format="json",
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data, {"status": "accepted"})
        self.assertIsNone(Account.objects.get(pk=self.account.pk).mobile_verified_at)

    @patch("accounts.views.get_otp_provider")
    def test_verified_login_returns_jwt_and_marks_mobile_verified(self, get_provider):
        provider = Mock()
        provider.verify_code.return_value = True
        get_provider.return_value = provider

        response = self.client.post(
            "/api/v1/auth/login",
            {"mobile_e164": self.account.mobile_e164, "code": "provider-code"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["access"])
        self.assertTrue(response.data["refresh"])
        self.account.refresh_from_db()
        self.assertIsNotNone(self.account.mobile_verified_at)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {response.data['access']}"
        )
        me_response = self.client.get("/api/v1/auth/me")
        self.assertEqual(me_response.status_code, 200)

    @patch("accounts.views.get_otp_provider")
    def test_invalid_code_does_not_verify_mobile_or_issue_token(self, get_provider):
        provider = Mock()
        provider.verify_code.return_value = False
        get_provider.return_value = provider

        response = self.client.post(
            "/api/v1/auth/login",
            {"mobile_e164": self.account.mobile_e164, "code": "wrong"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access", response.data)
        self.assertIsNone(Account.objects.get(pk=self.account.pk).mobile_verified_at)

    @patch("accounts.views.get_otp_provider")
    def test_blocked_account_cannot_login_even_after_provider_verifies(self, get_provider):
        provider = Mock()
        provider.verify_code.return_value = True
        get_provider.return_value = provider
        self.account.access_state = AccountAccessState.BLOCKED
        self.account.save()

        response = self.client.post(
            "/api/v1/auth/login",
            {"mobile_e164": self.account.mobile_e164, "code": "provider-code"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["code"], "ACCOUNT_BLOCKED")
        self.assertNotIn("access", response.data)

    def test_protected_me_endpoint_rejects_anonymous_request(self):
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, 401)

    def test_old_access_token_stays_revoked_after_account_restoration(self):
        refresh = RefreshToken.for_user(self.account)
        refresh["token_version"] = self.account.token_version
        access = str(refresh.access_token)

        self.account.access_state = AccountAccessState.BLOCKED
        self.account.save()
        self.account.access_state = AccountAccessState.ACTIVE
        self.account.save()

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, 401)

    def test_logout_invalidates_current_access_and_refresh_tokens(self):
        refresh = RefreshToken.for_user(self.account)
        refresh["token_version"] = self.account.token_version
        access = str(refresh.access_token)
        refresh_value = str(refresh)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

        response = self.client.post("/api/v1/auth/logout")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.account.__class__.objects.get(pk=self.account.pk).token_version, 1)

        protected_response = self.client.get("/api/v1/auth/me")
        self.assertEqual(protected_response.status_code, 401)
        refresh_response = self.client.post(
            "/api/v1/auth/refresh",
            {"refresh": refresh_value},
            format="json",
        )
        self.assertEqual(refresh_response.status_code, 401, refresh_response.data)

    def test_disabled_staff_account_is_not_active(self):
        staff = create_account("+14155550121", AccountType.STAFF)
        profile = StaffProfile.objects.get(account=staff)
        profile.state = StaffState.DISABLED
        profile.save()
        staff.refresh_from_db()
        self.assertFalse(staff.is_active)
        self.assertEqual(staff.token_version, 1)
