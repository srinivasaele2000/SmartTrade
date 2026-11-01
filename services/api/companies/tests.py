import tempfile
from pathlib import Path
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import (
    Account,
    AccountAccessState,
    AccountType,
    StaffPermission,
    StaffRole,
    StaffRoleAssignment,
    StaffRolePermission,
)

from .models import (
    CompanyActivityState,
    CompanyAuditEvent,
    CompanyCaseState,
    CompanyAuditEvent,
    CompanyDocument,
    CompanyProfile,
    CompanyVerificationCase,
    CompanyVerificationCase,
    CompanyVerificationState,
)


def make_account(mobile, account_type):
    return Account.objects.create_user(mobile_e164=mobile, account_type=account_type)


def grant_staff_permissions(staff, codes):
    role = StaffRole.objects.create(code=f"TEST_{staff.pk}")
    for code in codes:
        permission, _ = StaffPermission.objects.get_or_create(code=code)
        StaffRolePermission.objects.create(role=role, permission=permission)
    StaffRoleAssignment.objects.create(
        staff_account=staff,
        role=role,
        grant_source=StaffRoleAssignment.GrantSource.BOOTSTRAP,
    )


class CompanyRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_account("+14155550201", AccountType.COMPANY)
        self.client.force_authenticate(self.owner)

    def register_company(self):
        return self.client.post(
            "/api/v1/companies/register",
            {
                "legal_name": "Northwind Tools Ltd",
                "company_email": "verification@northwind.example",
                "registration_number": "NW-100",
            },
            format="json",
        )

    def test_company_account_can_register_only_one_company(self):
        response = self.register_company()
        self.assertEqual(response.status_code, 201)
        profile = CompanyProfile.objects.get(owner_account=self.owner)
        self.assertEqual(profile.verification_state, CompanyVerificationState.PENDING)
        self.assertEqual(profile.activity_state, CompanyActivityState.ACTIVE)
        self.assertFalse(profile.can_publish_catalogue)
        duplicate = self.register_company()
        self.assertEqual(duplicate.status_code, 409)

    def test_non_company_account_cannot_register_company(self):
        personal = make_account("+14155550202", AccountType.PERSONAL)
        self.client.force_authenticate(personal)
        response = self.register_company()
        self.assertEqual(response.status_code, 403)

    def test_company_email_change_clears_previous_verification(self):
        self.register_company()
        profile = CompanyProfile.objects.get(owner_account=self.owner)
        profile.email_verified_at = timezone.now()
        profile.save()
        response = self.client.patch(
            "/api/v1/companies/me",
            {"company_email": "new@northwind.example"},
            format="json",
        )
        profile.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(profile.email_verified_at)

    def test_company_audit_events_are_immutable_through_the_model(self):
        self.register_company()
        company = CompanyProfile.objects.get(owner_account=self.owner)
        event = CompanyAuditEvent.objects.get(company=company, action="COMPANY_REGISTERED")
        event.reason = "changed"
        with self.assertRaises(ValidationError):
            event.save()
        with self.assertRaises(ValidationError):
            event.delete()

    def test_company_owner_cannot_be_changed_through_model_save(self):
        self.register_company()
        profile = CompanyProfile.objects.get(owner_account=self.owner)
        profile.owner_account = make_account("+14155550203", AccountType.COMPANY)
        with self.assertRaises(ValidationError):
            profile.save()

    @patch("companies.views.get_company_email_provider")
    def test_email_verification_uses_configured_provider_and_marks_real_success(self, get_provider):
        self.register_company()
        provider = Mock()
        provider.send_code.return_value = True
        provider.verify_code.return_value = True
        get_provider.return_value = provider
        requested = self.client.post("/api/v1/companies/me/email-verification/request")
        confirmed = self.client.post(
            "/api/v1/companies/me/email-verification/confirm",
            {"code": "provider-issued-code"},
            format="json",
        )
        profile = CompanyProfile.objects.get(owner_account=self.owner)
        self.assertEqual(requested.status_code, 202)
        self.assertEqual(confirmed.status_code, 200)
        self.assertIsNotNone(profile.email_verified_at)
        provider.send_code.assert_called_once_with(profile.company_email)
        provider.verify_code.assert_called_once_with(profile.company_email, "provider-issued-code")

    @override_settings(SMARTTRADE_COMPANY_EMAIL_PROVIDER="")
    def test_email_verification_fails_closed_without_provider(self):
        self.register_company()
        response = self.client.post("/api/v1/companies/me/email-verification/request")
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(CompanyProfile.objects.get(owner_account=self.owner).email_verified_at)


class CompanyVerificationTests(TestCase):
    file_policy = override_settings(
        SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=1024,
        SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=("application/pdf",),
        SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=("COMPANY_REGISTRATION",),
    )

    def setUp(self):
        self.temp_root = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.file_policy.enable()
        self.media_override = override_settings(MEDIA_ROOT=self.temp_root.name)
        self.media_override.enable()
        self.addCleanup(self.media_override.disable)
        self.addCleanup(self.file_policy.disable)
        self.addCleanup(self.temp_root.cleanup)
        self.client = APIClient()
        self.owner = make_account("+14155550211", AccountType.COMPANY)
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/v1/companies/register",
            {"legal_name": "Contoso Manufacturing", "company_email": "verify@contoso.example"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.company = CompanyProfile.objects.get(owner_account=self.owner)

    def upload_registration_document(self):
        return self.client.post(
            "/api/v1/companies/me/documents",
            {
                "document_type": "COMPANY_REGISTRATION",
                "file": SimpleUploadedFile(
                    "registration.pdf",
                    b"%PDF-1.7\nregistration evidence",
                    content_type="application/pdf",
                ),
            },
            format="multipart",
        )

    def prepare_submission(self):
        self.company.email_verified_at = timezone.now()
        self.company.save()
        upload = self.upload_registration_document()
        self.assertEqual(upload.status_code, 201)
        return self.client.post("/api/v1/companies/me/verification-submissions")

    def claim_case(self, staff_client):
        return staff_client.post(f"/api/v1/staff/companies/{self.company.pk}/claim")

    def test_submission_requires_email_and_configured_required_documents(self):
        response = self.client.post("/api/v1/companies/me/verification-submissions")
        self.assertEqual(response.status_code, 409)
        self.company.email_verified_at = timezone.now()
        self.company.save()
        upload = self.upload_registration_document()
        self.assertEqual(upload.status_code, 201)
        submission = self.client.post("/api/v1/companies/me/verification-submissions")
        self.assertEqual(submission.status_code, 201)
        case = CompanyVerificationCase.objects.get(company=self.company)
        self.assertEqual(case.status, CompanyCaseState.PENDING)
        self.assertEqual(case.documents.count(), 1)

    def test_missing_required_document_blocks_submission(self):
        self.company.email_verified_at = timezone.now()
        self.company.save()
        response = self.client.post("/api/v1/companies/me/verification-submissions")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "REQUIRED_DOCUMENTS_MISSING")

    def test_file_size_type_and_signature_are_validated(self):
        too_large = self.client.post(
            "/api/v1/companies/me/documents",
            {"document_type": "COMPANY_REGISTRATION", "file": SimpleUploadedFile("large.pdf", b"%PDF-" + b"x" * 1024, content_type="application/pdf")},
            format="multipart",
        )
        forged_type = self.client.post(
            "/api/v1/companies/me/documents",
            {"document_type": "COMPANY_REGISTRATION", "file": SimpleUploadedFile("forged.pdf", b"not a PDF", content_type="application/pdf")},
            format="multipart",
        )
        self.assertEqual(too_large.status_code, 400)
        self.assertEqual(forged_type.status_code, 400)
        self.assertFalse(CompanyDocument.objects.exists())

    def test_upload_fails_closed_when_file_policy_is_unconfigured(self):
        with override_settings(
            SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=None,
            SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=(),
            SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=(),
        ):
            response = self.client.post(
                "/api/v1/companies/me/documents",
                {"document_type": "COMPANY_REGISTRATION", "file": SimpleUploadedFile("file.pdf", b"%PDF-1.7", content_type="application/pdf")},
                format="multipart",
            )
        self.assertEqual(response.status_code, 503)

    def test_company_review_requires_staff_permission_and_records_reason(self):
        submission = self.prepare_submission()
        self.assertEqual(submission.status_code, 201)
        reviewer = make_account("+14155550212", AccountType.STAFF)
        grant_staff_permissions(reviewer, ["REVIEW_COMPANY"])
        staff_client = APIClient()
        staff_client.force_authenticate(reviewer)
        queue = staff_client.get("/api/v1/staff/companies/verification-queue")
        self.assertEqual(queue.status_code, 200)
        queue_case = queue.data["results"][0]
        self.assertIsNone(queue_case["assigned_reviewer_account_id"])
        self.assertEqual(queue_case["company"]["legal_name"], self.company.legal_name)
        self.assertEqual(queue_case["documents"][0]["document_type"], "COMPANY_REGISTRATION")
        self.assertEqual(queue_case["documents"][0]["id"], self.company.documents.get().pk)
        self.assertNotIn("file", queue_case["documents"][0])
        claim = self.claim_case(staff_client)
        self.assertEqual(claim.status_code, 200)
        response = staff_client.post(
            f"/api/v1/staff/companies/{self.company.pk}/verification-decision",
            {"decision": "APPROVE", "reason": "Registration evidence matches."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.verification_state, CompanyVerificationState.VERIFIED)
        self.assertTrue(self.company.can_publish_catalogue)
        case = CompanyVerificationCase.objects.get(company=self.company)
        self.assertEqual(case.reviewed_by.account_id, reviewer.pk)
        self.assertEqual(case.decision_reason, "Registration evidence matches.")
        event = CompanyAuditEvent.objects.get(action="COMPANY_VERIFICATION_APPROVED")
        self.assertEqual(event.actor_id, reviewer.pk)
        self.assertEqual(event.reason, "Registration evidence matches.")

    def test_review_decision_requires_reason_and_company_cannot_review_itself(self):
        self.prepare_submission()
        company_response = self.client.post(
            f"/api/v1/staff/companies/{self.company.pk}/verification-decision",
            {"decision": "APPROVE", "reason": "self"},
            format="json",
        )
        self.assertEqual(company_response.status_code, 403)
        reviewer = make_account("+14155550213", AccountType.STAFF)
        grant_staff_permissions(reviewer, ["REVIEW_COMPANY"])
        staff_client = APIClient()
        staff_client.force_authenticate(reviewer)
        claim = self.claim_case(staff_client)
        self.assertEqual(claim.status_code, 200)
        response = staff_client.post(
            f"/api/v1/staff/companies/{self.company.pk}/verification-decision",
            {"decision": "REJECT", "reason": "  "},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_staff_can_reject_with_reason_without_blocking_owner_account(self):
        self.prepare_submission()
        reviewer = make_account("+14155550218", AccountType.STAFF)
        grant_staff_permissions(reviewer, ["REVIEW_COMPANY"])
        staff_client = APIClient()
        staff_client.force_authenticate(reviewer)
        claim = self.claim_case(staff_client)
        self.assertEqual(claim.status_code, 200)
        response = staff_client.post(
            f"/api/v1/staff/companies/{self.company.pk}/verification-decision",
            {"decision": "REJECT", "reason": "Registration record was incomplete."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.company.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.company.verification_state, CompanyVerificationState.REJECTED)
        self.assertFalse(self.company.can_publish_catalogue)
        self.assertEqual(self.owner.access_state, AccountAccessState.ACTIVE)
        self.assertEqual(
            CompanyAuditEvent.objects.get(action="COMPANY_VERIFICATION_REJECTED").reason,
            "Registration record was incomplete.",
        )

    def test_company_suspension_blocks_company_writes_without_blocking_account(self):
        self.company.verification_state = CompanyVerificationState.VERIFIED
        self.company.save()
        self.assertTrue(self.company.can_publish_catalogue)
        staff = make_account("+14155550214", AccountType.STAFF)
        grant_staff_permissions(staff, ["SUSPEND_COMPANY", "RESTORE_COMPANY", "HANDLE_REVIEW_REQUESTS"])
        staff_client = APIClient()
        staff_client.force_authenticate(staff)
        suspended = staff_client.post(
            f"/api/v1/staff/companies/{self.company.pk}/suspend",
            {"reason": "Compliance review."},
            format="json",
        )
        self.assertEqual(suspended.status_code, 200)
        self.company.refresh_from_db()
        self.owner.refresh_from_db()
        version = self.owner.token_version
        self.assertEqual(self.company.activity_state, CompanyActivityState.SUSPENDED)
        self.assertFalse(self.company.can_publish_catalogue)
        self.assertEqual(self.owner.access_state, AccountAccessState.ACTIVE)
        self.assertEqual(self.owner.token_version, version)
        status_response = self.client.get("/api/v1/companies/me")
        write_response = self.client.patch(
            "/api/v1/companies/me",
            {"trading_name": "Blocked Update"},
            format="json",
        )
        review_response = self.client.post(
            "/api/v1/companies/me/review-requests",
            {"reason": "Please review the suspension."},
            format="json",
        )
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.data["company"]["activity_state"], "SUSPENDED")
        self.assertEqual(write_response.status_code, 403)
        self.assertEqual(review_response.status_code, 201)
        review_queue = staff_client.get("/api/v1/staff/companies/review-requests")
        self.assertEqual(review_queue.status_code, 200)
        review_request_id = review_response.data["id"]
        resolved = staff_client.post(
            f"/api/v1/staff/companies/review-requests/{review_request_id}/resolve",
            {"reason": "Suspension review was recorded."},
            format="json",
        )
        self.assertEqual(resolved.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.activity_state, CompanyActivityState.SUSPENDED)
        self.assertEqual(self.owner.access_state, AccountAccessState.ACTIVE)
        restored = staff_client.post(
            f"/api/v1/staff/companies/{self.company.pk}/restore",
            {"reason": "Review complete."},
            format="json",
        )
        self.assertEqual(restored.status_code, 200)
        self.company.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.company.activity_state, CompanyActivityState.ACTIVE)
        self.assertEqual(self.owner.access_state, AccountAccessState.ACTIVE)
        self.assertEqual(self.owner.token_version, version)
        actions = set(CompanyAuditEvent.objects.values_list("action", flat=True))
        self.assertTrue({"COMPANY_SUSPENDED", "COMPANY_RESTORED", "COMPANY_REVIEW_REQUESTED"}.issubset(actions))

    def test_private_document_download_is_owner_scoped_and_audited(self):
        uploaded = self.upload_registration_document()
        self.assertEqual(uploaded.status_code, 201)
        document_id = uploaded.data["document"]["id"]
        response = self.client.get(f"/api/v1/companies/me/documents/{document_id}")
        self.assertEqual(response.status_code, 200)
        # The test client's streaming wrapper closes the response and manages
        # request-finished signals without closing TestCase's transaction.
        self.assertEqual(b"".join(response.streaming_content), b"%PDF-1.7\nregistration evidence")
        self.assertTrue(CompanyAuditEvent.objects.filter(action="COMPANY_DOCUMENT_DOWNLOADED", actor=self.owner).exists())
        other = make_account("+14155550215", AccountType.COMPANY)
        other_client = APIClient()
        other_client.force_authenticate(other)
        self.assertEqual(other_client.get(f"/api/v1/companies/me/documents/{document_id}").status_code, 404)
        self.company.email_verified_at = timezone.now()
        self.company.save()
        submitted = self.client.post("/api/v1/companies/me/verification-submissions")
        self.assertEqual(submitted.status_code, 201)
        reviewer = make_account("+14155550216", AccountType.STAFF)
        grant_staff_permissions(reviewer, ["REVIEW_COMPANY", "VIEW_PRIVATE_DOCUMENTS"])
        reviewer_client = APIClient()
        reviewer_client.force_authenticate(reviewer)
        claim = self.claim_case(reviewer_client)
        self.assertEqual(claim.status_code, 200)
        staff_download = reviewer_client.get(
            f"/api/v1/staff/companies/{self.company.pk}/documents/{document_id}"
        )
        self.assertEqual(staff_download.status_code, 200)
        self.assertEqual(b"".join(staff_download.streaming_content), b"%PDF-1.7\nregistration evidence")


class CompanyReviewRequestWorkflowTests(TestCase):
    def setUp(self):
        from .models import CompanyReviewRequest

        self.owner = make_account('+14155550301', AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(
            owner_account=self.owner, legal_name='Review Company', company_email='review@example.test',
            verification_state='REJECTED', activity_state='SUSPENDED',
        )
        self.review_request = CompanyReviewRequest.objects.create(
            company=self.company, submitted_by=self.owner, reason='Please review the registration evidence.',
        )
        self.staff = make_account('+14155550302', AccountType.STAFF)
        grant_staff_permissions(self.staff, ['HANDLE_REVIEW_REQUESTS'])
        self.client = APIClient()
        self.client.force_authenticate(self.staff)
        self.path = f'/api/v1/staff/companies/review-requests/{self.review_request.pk}/resolve'

    def test_queue_resolution_audits_actor_reason_and_preserves_restrictions(self):
        queue = self.client.get('/api/v1/staff/companies/review-requests')
        self.assertEqual(queue.status_code, 200)
        self.assertEqual(queue.data['results'][0]['verification_state'], 'REJECTED')
        self.assertEqual(queue.data['results'][0]['activity_state'], 'SUSPENDED')
        response = self.client.post(self.path, {'reason': 'Evidence review recorded; suspension remains.'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.review_request.refresh_from_db()
        self.company.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.review_request.state, 'RESOLVED')
        self.assertEqual(self.review_request.resolved_by_id, self.staff.pk)
        self.assertIsNotNone(self.review_request.resolved_at)
        self.assertEqual(self.company.verification_state, 'REJECTED')
        self.assertEqual(self.company.activity_state, 'SUSPENDED')
        self.assertEqual(self.owner.access_state, AccountAccessState.ACTIVE)
        event = CompanyAuditEvent.objects.get(action='COMPANY_REVIEW_REQUEST_RESOLVED')
        self.assertEqual(event.actor_id, self.staff.pk)
        self.assertEqual(event.company_id, self.company.pk)
        self.assertEqual(event.reason, self.review_request.resolution_reason)
        self.assertEqual(event.details['review_request_id'], self.review_request.pk)
        self.assertEqual(self.client.get('/api/v1/staff/companies/review-requests').data['results'], [])
        self.assertEqual(self.client.post(self.path, {'reason': 'Repeat'}, format='json').status_code, 409)
        self.assertEqual(CompanyAuditEvent.objects.filter(action='COMPANY_REVIEW_REQUEST_RESOLVED').count(), 1)

    def test_resolution_requires_reason_and_dedicated_permission(self):
        self.assertEqual(self.client.post(self.path, {'reason': '  '}, format='json').status_code, 400)
        other = make_account('+14155550303', AccountType.STAFF)
        grant_staff_permissions(other, ['REVIEW_COMPANY'])
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/v1/staff/companies/review-requests').status_code, 403)
        self.assertEqual(self.client.post(self.path, {'reason': 'Unauthorized'}, format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.path, {'reason': 'Self review'}, format='json').status_code, 403)
        self.review_request.refresh_from_db()
        self.assertEqual(self.review_request.state, 'OPEN')
        self.assertFalse(CompanyAuditEvent.objects.filter(action='COMPANY_REVIEW_REQUEST_RESOLVED').exists())


class CompanyStaffPermissionTests(TestCase):
    def test_staff_without_required_permission_cannot_read_verification_queue(self):
        staff = make_account("+14155550220", AccountType.STAFF)
        grant_staff_permissions(staff, ["READ_REPORTS"])
        client = APIClient()
        client.force_authenticate(staff)
        response = client.get("/api/v1/staff/companies/verification-queue")
        self.assertEqual(response.status_code, 403)

    def test_company_account_cannot_access_staff_queue(self):
        company_account = make_account("+14155550221", AccountType.COMPANY)
        client = APIClient()
        client.force_authenticate(company_account)
        response = client.get("/api/v1/staff/companies/verification-queue")
        self.assertEqual(response.status_code, 403)


@skipUnless(
    connection.vendor == "postgresql",
    "requires DB_ENGINE=postgresql to execute company migration triggers",
)
class CompanyPostgreSQLGuardTests(TestCase):
    def test_database_rejects_non_company_owner(self):
        personal = make_account("+14155550230", AccountType.PERSONAL)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CompanyProfile.objects.bulk_create(
                    [
                        CompanyProfile(
                            owner_account=personal,
                            legal_name="Invalid owner",
                            company_email="invalid@example.test",
                        )
                    ]
                )

    def test_database_rejects_submission_by_non_owner(self):
        owner = make_account("+14155550231", AccountType.COMPANY)
        other = make_account("+14155550232", AccountType.COMPANY)
        company = CompanyProfile.objects.create(
            owner_account=owner,
            legal_name="Owner company",
            company_email="owner@example.test",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CompanyVerificationCase.objects.create(company=company, submitted_by=other)

    def test_database_rejects_document_uploaded_by_another_account(self):
        owner = make_account("+14155550233", AccountType.COMPANY)
        other = make_account("+14155550234", AccountType.COMPANY)
        company = CompanyProfile.objects.create(
            owner_account=owner,
            legal_name="Document owner company",
            company_email="documents@example.test",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CompanyDocument.objects.create(
                    company=company,
                    document_type="REGISTRATION",
                    file="private/company-documents/fake.pdf",
                    original_filename="fake.pdf",
                    content_type="application/pdf",
                    size_bytes=10,
                    uploaded_by=other,
                )

    def test_database_rejects_company_audit_mutation(self):
        owner = make_account("+14155550235", AccountType.COMPANY)
        company = CompanyProfile.objects.create(
            owner_account=owner,
            legal_name="Audited company",
            company_email="audit@example.test",
        )
        event = CompanyAuditEvent.objects.create(
            company=company,
            actor=owner,
            action="COMPANY_REGISTERED",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CompanyAuditEvent.objects.filter(pk=event.pk).update(reason="tampered")



@override_settings(DEBUG=True, SMARTTRADE_ENABLE_DEV_EMAIL=True, SMARTTRADE_COMPANY_EMAIL_PROVIDER="", ALLOWED_HOSTS=["localhost", "testserver"])
class DevelopmentCompanyEmailTests(TestCase):
    def setUp(self):
        uploads = tempfile.TemporaryDirectory()
        self.addCleanup(uploads.cleanup)
        media = override_settings(MEDIA_ROOT=uploads.name)
        media.enable()
        self.addCleanup(media.disable)
        self.owner = make_account("+12025550181", AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(owner_account=self.owner, legal_name="Local Email Test", company_email="company@example.test")
        self.client = APIClient(HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
        self.client.force_authenticate(self.owner)

    def confirm(self, code="local-test"):
        return self.client.post("/api/v1/companies/me/email-verification/confirm", {"code": code}, format="json")

    def test_local_simulation_is_explicit_and_not_real_ownership(self):
        response = self.client.post("/api/v1/companies/me/email-verification/request", {}, format="json")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["mode"], "development_email")
        self.assertEqual(self.confirm().status_code, 200)
        self.company.refresh_from_db()
        self.assertIsNone(self.company.email_verified_at)
        self.assertTrue(self.client.get("/api/v1/companies/me").data["verification"]["email_ready"])
        self.assertTrue(self.company.audit_events.filter(action="COMPANY_EMAIL_DEV_VERIFIED").exists())

    def test_empty_code_rejected(self):
        self.assertEqual(self.confirm(" ").status_code, 400)

    def test_debug_false_and_disabled_flag_fail_closed(self):
        self.confirm()
        for values in [{"DEBUG": False}, {"SMARTTRADE_ENABLE_DEV_EMAIL": False}]:
            with override_settings(**values):
                self.assertEqual(self.confirm().status_code, 503)
                self.assertFalse(self.client.get("/api/v1/companies/me").data["verification"]["email_ready"])

    def test_non_loopback_request_cannot_simulate(self):
        self.client.defaults["REMOTE_ADDR"] = "192.0.2.1"
        self.assertEqual(self.confirm().status_code, 503)

    def test_untrusted_origin_cannot_simulate(self):
        self.client.defaults["HTTP_ORIGIN"] = "https://example.test"
        self.assertEqual(self.confirm().status_code, 503)

    def test_email_change_invalidates_development_evidence(self):
        self.confirm()
        self.assertEqual(self.client.patch("/api/v1/companies/me", {"company_email": "changed@example.test"}, format="json").status_code, 200)
        self.assertFalse(self.client.get("/api/v1/companies/me").data["verification"]["email_ready"])
        self.client.patch("/api/v1/companies/me", {"company_email": "company@example.test"}, format="json")
        self.assertFalse(self.client.get("/api/v1/companies/me").data["verification"]["email_ready"])

    def test_rejected_and_suspended_cannot_change_email_evidence(self):
        self.company.verification_state = CompanyVerificationState.REJECTED
        self.company.save()
        self.assertEqual(self.confirm().status_code, 409)
        self.company.activity_state = CompanyActivityState.SUSPENDED
        self.company.save()
        self.assertEqual(self.confirm().status_code, 403)

    @override_settings(SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=("REGISTRATION",), SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=1024, SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=("application/pdf",))
    def test_simulated_email_allows_submission_and_preserves_document_count(self):
        self.confirm()
        missing = self.client.post("/api/v1/companies/me/verification-submissions", {}, format="json")
        self.assertEqual(missing.status_code, 400)
        upload = self.client.post("/api/v1/companies/me/documents", {"document_type": "REGISTRATION", "file": SimpleUploadedFile("local.pdf", b"%PDF-1.4 local test", content_type="application/pdf")}, format="multipart")
        self.assertEqual(upload.status_code, 201)
        submitted = self.client.post("/api/v1/companies/me/verification-submissions", {}, format="json")
        self.assertEqual(submitted.status_code, 201)
        self.assertEqual(self.client.post("/api/v1/companies/me/verification-submissions", {}, format="json").status_code, 409)
        self.assertEqual(self.company.audit_events.get(action="COMPANY_VERIFICATION_SUBMITTED").details["document_count"], 1)


    def test_staff_queue_labels_simulation_without_real_ownership(self):
        self.confirm()
        CompanyVerificationCase.objects.create(company=self.company, submitted_by=self.owner)
        staff = make_account("+12025550182", AccountType.STAFF)
        grant_staff_permissions(staff, ["REVIEW_COMPANY"])
        self.client.force_authenticate(staff)
        response = self.client.get("/api/v1/staff/companies/verification-queue")
        self.assertEqual(response.data["results"][0]["email_verification_mode"], "development_simulated")
        with override_settings(DEBUG=False):
            response = self.client.get("/api/v1/staff/companies/verification-queue")
            self.assertEqual(response.data["results"][0]["email_verification_mode"], "unverified")

    @override_settings(SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES=("REGISTRATION",), SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES=1024, SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES=("application/pdf",))
    def test_private_document_response_is_not_cacheable(self):
        response = self.client.post("/api/v1/companies/me/documents", {"document_type": "REGISTRATION", "file": SimpleUploadedFile("local.pdf", b"%PDF-1.4 local test", content_type="application/pdf")}, format="multipart")
        self.assertEqual(response.status_code, 201)
        download = self.client.get(f"/api/v1/companies/me/documents/{response.data['document']['id']}")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["Cache-Control"], "private, no-store")
        self.assertEqual(download["X-Content-Type-Options"], "nosniff")
        # Exhaust the test client wrapper so it safely closes the private file
        # without closing the enclosing PostgreSQL TestCase transaction.
        self.assertTrue(b"".join(download.streaming_content).startswith(b"%PDF-"))
