from unittest import skipUnless

from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from .models import Account, AccountType, EmployerProfile, ServiceProviderProfile


class RegistrationRolesTests(TestCase):
    register = '/api/v1/auth/register'

    def test_six_public_roles_get_their_matching_profiles(self):
        cases = (
            ('CUSTOMER', 'PERSONAL', 'personal_profile'),
            ('BUSINESS_DEALER', 'BUSINESS', 'business_profile'),
            ('COMPANY_BRAND', 'COMPANY', 'company_user_profile'),
            ('SERVICE_PROVIDER', 'SERVICE_PROVIDER', 'serviceproviderprofile'),
            ('JOB_SEEKER', 'JOB_SEEKER', 'jobseekerprofile'),
            ('EMPLOYER', 'EMPLOYER', 'employerprofile'),
        )
        for index, (role, kind, profile) in enumerate(cases):
            with self.subTest(role=role):
                mobile = f'+91980000010{index}'
                reply = self.client.post(self.register, {'role': role, 'mobile_e164': mobile}, content_type='application/json')
                self.assertEqual(reply.status_code, 201, reply.json())
                self.assertEqual(reply.json()['account']['role'], role)
                self.assertEqual(reply.json()['account']['account_type'], kind)
                account = Account.objects.get(mobile_e164=mobile)
                self.assertEqual(getattr(account, profile).account_id, account.pk)
                self.assertIsNone(account.mobile_verified_at)
                self.assertFalse(account.is_staff)

    def test_conflicting_and_staff_roles_rejected_and_mobile_is_unique(self):
        mobile = '+919800000117'
        client = APIClient()
        for values in ({'role': 'PLATFORM_ADMIN'}, {'account_type': 'STAFF'}, {},
                       {'role': 'EMPLOYER', 'account_type': 'PERSONAL'}):
            self.assertEqual(client.post(self.register, {'mobile_e164': mobile, **values}, format='json').status_code, 400)
        self.assertEqual(client.post(self.register, {'mobile_e164': mobile, 'account_type': 'PERSONAL'}, format='json').status_code, 201)
        self.assertEqual(client.post(self.register, {'mobile_e164': mobile, 'role': 'JOB_SEEKER'}, format='json').status_code, 409)

    @override_settings(DEBUG=True, SMARTTRADE_ENABLE_DEV_OTP=True, SMARTTRADE_OTP_PROVIDER='', ALLOWED_HOSTS=['localhost'])
    def test_otp_sessions_for_new_roles_preserve_role_boundaries(self):
        for index, (kind, path, fields) in enumerate((
            ('SERVICE_PROVIDER', 'service-provider-profile', {'full_name': 'Fixture provider', 'trade': 'Electrician'}),
            ('JOB_SEEKER', 'job-seeker-profile', {'skills': 'Wiring', 'experience': 'Apprenticeship', 'preferred_location': 'Pune'}),
            ('EMPLOYER', 'employer-profile', {'organization_name': 'Fixture employer', 'contact_name': 'Fixture reviewer'}),
        )):
            with self.subTest(kind=kind):
                account = Account.objects.create_user(f'+91980000012{index}', kind)
                client = APIClient(HTTP_HOST='localhost')
                url = '/api/v1/auth/' + path
                self.assertEqual(client.get(url).status_code, 401)
                login = client.post('/api/v1/auth/login', {'mobile_e164': account.mobile_e164, 'code': 'test'}, format='json')
                self.assertEqual(login.status_code, 200, login.data)
                self.assertEqual(AccessToken(login.data['access'])['role'], kind)
                client.credentials(HTTP_AUTHORIZATION='Bearer ' + login.data['access'])
                self.assertEqual(client.get('/api/v1/auth/me').data['account']['role'], kind)
                patched = client.patch(url, {**fields, 'pin_code': '411001', 'state': 'maharashtra'}, format='json')
                self.assertEqual(patched.status_code, 200, patched.data)
                self.assertEqual(patched['Cache-Control'], 'no-store')
                self.assertEqual(client.get(url).data['state'], 'Maharashtra')
                self.assertEqual(client.patch(url, {'pin_code': '123'}, format='json').status_code, 400)
                self.assertEqual(client.patch(url, {'role': 'PLATFORM_ADMIN'}, format='json').status_code, 400)
                self.assertEqual(client.get('/api/v1/auth/personal-profile').status_code, 403)
                self.assertEqual(client.get('/api/v1/staff/companies/verification-queue').status_code, 403)
                other = 'employer-profile' if kind != 'EMPLOYER' else 'job-seeker-profile'
                self.assertEqual(client.get('/api/v1/auth/' + other).status_code, 403)
                account.access_state = 'BLOCKED'
                account.save()
                self.assertEqual(client.get(url).status_code, 401)

    @skipUnless(connection.vendor == 'postgresql', 'PostgreSQL subtype guards required')
    def test_database_rejects_missing_wrong_and_reassigned_subtypes(self):
        provider = Account.objects.create_user('+919800000128', AccountType.SERVICE_PROVIDER)
        employer = Account.objects.create_user('+919800000129', AccountType.EMPLOYER)
        for write in (
            lambda: ServiceProviderProfile.objects.filter(account=provider).delete(),
            lambda: EmployerProfile.objects.create(account=provider),
            lambda: ServiceProviderProfile.objects.filter(account=provider).update(account=employer),
        ):
            with self.assertRaises(IntegrityError), transaction.atomic():
                write()
                with connection.cursor() as cursor:
                    cursor.execute('SET CONSTRAINTS ALL IMMEDIATE')
