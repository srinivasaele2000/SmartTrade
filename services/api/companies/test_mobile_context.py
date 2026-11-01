from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from .models import CompanyProfile, CompanyDocument, CompanyVerificationCase, CompanyReviewRequest


@override_settings(SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=('REGISTRATION',),
                   SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=2048,
                   SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=('application/pdf',),
                   SMARTTRADE_COMPANY_EMAIL_PROVIDER='')
class MobileCompanyContextTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('+12025550131', 'COMPANY')
        self.company = CompanyProfile.objects.create(owner_account=self.owner, legal_name='Test company', company_email='test@example.test')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def context(self):
        response = self.client.get('/api/v1/companies/me')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store')
        return response.data['verification']

    def test_policy_status_and_permissions_are_actual_server_state(self):
        value = self.context()
        self.assertEqual(value['document_policy']['required_types'], ['REGISTRATION'])
        self.assertEqual(value['document_policy']['max_bytes'], 2048)
        self.assertEqual(value['missing_document_types'], ['REGISTRATION'])
        self.assertTrue(value['can_edit'])
        self.assertTrue(value['can_upload'])
        self.assertFalse(value['can_submit'])
        self.assertFalse(value['email_provider_configured'])
        self.assertIsNone(value['application'])

    def test_documents_are_private_metadata_and_owner_scoped(self):
        CompanyDocument.objects.create(company=self.company, uploaded_by=self.owner, document_type='REGISTRATION', file='private/never-exposed.pdf', original_filename='registration.pdf', content_type='application/pdf', size_bytes=10)
        other = Account.objects.create_user('+12025550132', 'COMPANY')
        foreign = CompanyProfile.objects.create(owner_account=other, legal_name='Other', company_email='other@example.test')
        CompanyDocument.objects.create(company=foreign, uploaded_by=other, document_type='REGISTRATION', file='private/other.pdf', original_filename='other.pdf', content_type='application/pdf', size_bytes=10)
        value = self.context()
        self.assertEqual(len(value['documents']), 1)
        self.assertNotIn('file', value['documents'][0])
        self.assertNotIn('url', value['documents'][0])
        self.assertIsNone(value['documents'][0]['verification_case_id'])
        self.company.email_verified_at = timezone.now()
        self.company.save()
        self.assertTrue(self.context()['can_submit'])

    def test_existing_application_locks_edit_upload_and_duplicate_submission(self):
        case = CompanyVerificationCase.objects.create(company=self.company, submitted_by=self.owner)
        value = self.context()
        self.assertEqual(value['application']['id'], case.pk)
        self.assertEqual(value['application']['status'], 'PENDING')
        self.assertFalse(value['can_edit'])
        self.assertFalse(value['can_upload'])
        self.assertFalse(value['can_submit'])

    def test_suspension_preserves_account_and_allows_restricted_review(self):
        self.company.activity_state = 'SUSPENDED'
        self.company.save()
        CompanyReviewRequest.objects.create(company=self.company, submitted_by=self.owner, reason='Please review')
        value = self.context()
        self.assertTrue(self.owner.is_active)
        self.assertFalse(value['can_edit'])
        self.assertTrue(value['can_request_review'])
        self.assertEqual(value['review_requests'][0]['state'], 'OPEN')

    @override_settings(SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=None, SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=())
    def test_unconfigured_policy_never_invents_limits(self):
        value = self.context()
        self.assertFalse(value['document_policy']['configured'])
        self.assertIsNone(value['document_policy']['max_bytes'])
        self.assertEqual(value['document_policy']['required_types'], [])
        self.assertFalse(value['can_upload'])

    def test_non_company_and_blocked_accounts_cannot_read_context(self):
        personal = Account.objects.create_user('+12025550133', 'PERSONAL')
        self.client.force_authenticate(personal)
        self.assertEqual(self.client.get('/api/v1/companies/me').status_code, 403)
        self.owner.access_state = 'BLOCKED'
        self.owner.save()
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/v1/companies/me').status_code, 403)
