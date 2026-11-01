import logging
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import parsers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import AccountType, StaffProfile

from .email_verification import CompanyEmailProviderUnavailable, get_company_email_provider, development_enabled, development_verified, email_fingerprint, email_ready
from .models import (
    CompanyActivityState,
    CompanyAuditEvent,
    CompanyCaseState,
    CompanyDocument,
    CompanyProfile,
    CompanyReviewRequest,
    CompanyReviewRequestState,
    CompanyVerificationCase,
    CompanyVerificationState,
)
from .permissions import HasStaffPermission, IsCompanyAccount
from .serializers import (
    CompanyActionReasonSerializer,
    CompanyCaseQueueSerializer,
    CompanyDecisionSerializer,
    CompanyDocumentResponseSerializer,
    CompanyDocumentUploadSerializer,
    CompanyEmailCodeSerializer,
    CompanyProfileResponseSerializer,
    CompanyRegistrationSerializer,
    CompanyReviewRequestSerializer,
)


logger = logging.getLogger(__name__)


def api_error(code, message, http_status):
    return Response({"code": code, "message": message}, status=http_status)


def owned_company(account):
    try:
        return CompanyProfile.objects.get(owner_account=account)
    except CompanyProfile.DoesNotExist:
        return None


def record_company_event(company, actor, action, reason="", case=None, details=None):
    return CompanyAuditEvent.objects.create(
        company=company,
        verification_case=case,
        actor=actor,
        action=action,
        reason=reason,
        details=details or {},
    )


def staff_profile_for(account):
    return StaffProfile.objects.get(account=account)


class CompanyRegistrationView(APIView):
    permission_classes = [IsCompanyAccount]

    def post(self, request):
        if owned_company(request.user):
            return api_error(
                "COMPANY_ALREADY_REGISTERED",
                "This company account is already linked to a company.",
                status.HTTP_409_CONFLICT,
            )
        serializer = CompanyRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                company = serializer.save(owner_account=request.user)
                record_company_event(
                    company,
                    request.user,
                    "COMPANY_REGISTERED",
                    details={"verification_state": company.verification_state},
                )
        except IntegrityError:
            return api_error(
                "COMPANY_ALREADY_REGISTERED",
                "This company account is already linked to a company.",
                status.HTTP_409_CONFLICT,
            )
        return Response(
            {"company": CompanyProfileResponseSerializer(company).data},
            status=status.HTTP_201_CREATED,
        )


class CompanyMeView(APIView):
    permission_classes = [IsCompanyAccount]

    def get(self, request):
        company = owned_company(request.user)
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        cases = company.verification_cases.order_by("-submitted_at", "-pk")
        latest = cases.first()
        documents = company.documents.order_by("-uploaded_at", "-pk")
        required = list(settings.SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES)
        policy_ready = bool(required and settings.SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES and settings.SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES)
        editable = company.activity_state == CompanyActivityState.ACTIVE and company.verification_state == CompanyVerificationState.PENDING and latest is None
        missing = sorted(set(required) - set(documents.filter(verification_case__isnull=True).values_list("document_type", flat=True)))
        return Response({
            "company": CompanyProfileResponseSerializer(company).data,
            "verification": {
                "document_policy": {"configured": policy_ready, "required_types": required, "allowed_mime_types": list(settings.SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES), "max_bytes": settings.SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES},
                "documents": [{**CompanyDocumentResponseSerializer(doc).data, "verification_case_id": doc.verification_case_id} for doc in documents],
                "application": ({"id": latest.pk, "status": latest.status, "submitted_at": latest.submitted_at, "reviewed_at": latest.reviewed_at, "decision_reason": latest.decision_reason} if latest else None),
                "missing_document_types": missing,
                "email_provider_configured": bool(settings.SMARTTRADE_COMPANY_EMAIL_PROVIDER) or development_enabled(request),
                "email_verification_mode": "development_email" if development_enabled(request) else "provider",
                "email_ready": email_ready(company, request),
                "can_verify_email": editable,
                "can_edit": editable,
                "can_upload": editable and policy_ready,
                "can_submit": editable and bool(required) and not missing and email_ready(company, request),
                "can_request_review": company.activity_state == CompanyActivityState.SUSPENDED or company.verification_state == CompanyVerificationState.REJECTED,
                "review_requests": list(company.review_requests.order_by("-submitted_at").values("id", "state", "reason", "submitted_at")),
            },
        }, headers={"Cache-Control": "no-store"})

    @transaction.atomic
    def patch(self, request):
        company = CompanyProfile.objects.select_for_update().filter(owner_account=request.user).first()
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if company.activity_state == CompanyActivityState.SUSPENDED:
            return api_error("COMPANY_SUSPENDED", "Company changes are disabled while suspended.", status.HTTP_403_FORBIDDEN)
        if company.verification_state != CompanyVerificationState.PENDING or company.verification_cases.exists():
            return api_error("COMPANY_PROFILE_LOCKED", "This company profile is not editable in its current review state.", status.HTTP_409_CONFLICT)
        serializer = CompanyRegistrationSerializer(company, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        old_email = company.company_email
        company = serializer.save()
        if old_email.casefold() != company.company_email.casefold():
            company.email_verified_at = None
            company.save(update_fields=["email_verified_at", "updated_at"])
            record_company_event(company, request.user, "COMPANY_EMAIL_VERIFICATION_RESET")
        record_company_event(company, request.user, "COMPANY_PROFILE_UPDATED")
        return Response({"company": CompanyProfileResponseSerializer(company).data})


class CompanyEmailVerificationRequestView(APIView):
    permission_classes = [IsCompanyAccount]

    def post(self, request):
        company = owned_company(request.user)
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if company.activity_state == CompanyActivityState.SUSPENDED:
            return api_error("COMPANY_SUSPENDED", "Company-scoped activity is disabled.", status.HTTP_403_FORBIDDEN)
        if company.email_verified_at:
            return Response({"status": "verified"}, status=status.HTTP_200_OK)
        if development_enabled(request):
            if company.verification_state != CompanyVerificationState.PENDING or company.verification_cases.exists():
                return api_error("COMPANY_PROFILE_LOCKED", "Email simulation is locked in this review state.", 409)
            return Response({"status": "accepted", "mode": "development_email", "message": "Local simulation only; no email was sent."}, status=202)
        try:
            provider = get_company_email_provider()
        except CompanyEmailProviderUnavailable:
            provider = None
        if provider is None:
            return api_error("EMAIL_PROVIDER_UNAVAILABLE", "Company email verification is not configured.", status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            accepted = provider.send_code(company.company_email)
        except Exception:
            logger.warning("Configured company email provider failed to send a code")
            accepted = False
        if accepted is not True:
            return api_error("EMAIL_PROVIDER_UNAVAILABLE", "Company email verification is temporarily unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"status": "accepted"}, status=status.HTTP_202_ACCEPTED)


class CompanyEmailVerificationConfirmView(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def post(self, request):
        company = CompanyProfile.objects.select_for_update().filter(owner_account=request.user).first()
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if company.activity_state == CompanyActivityState.SUSPENDED:
            return api_error("COMPANY_SUSPENDED", "Company-scoped activity is disabled.", status.HTTP_403_FORBIDDEN)
        serializer = CompanyEmailCodeSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        if development_enabled(request):
            if company.verification_state != CompanyVerificationState.PENDING or company.verification_cases.exists():
                return api_error("COMPANY_PROFILE_LOCKED", "Email simulation is locked in this review state.", 409)
            record_company_event(company, request.user, "COMPANY_EMAIL_DEV_VERIFIED", details={"email_fingerprint": email_fingerprint(company), "mode": "development_email"})
            return Response({"company": CompanyProfileResponseSerializer(company).data, "mode": "development_email", "message": "Local simulation recorded; email ownership remains unverified."})
        try:
            provider = get_company_email_provider()
        except CompanyEmailProviderUnavailable:
            provider = None
        if provider is None:
            return api_error("EMAIL_PROVIDER_UNAVAILABLE", "Company email verification is not configured.", status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            verified = provider.verify_code(company.company_email, serializer.validated_data["code"])
        except Exception:
            logger.warning("Configured company email provider failed to verify a code")
            return api_error("EMAIL_PROVIDER_UNAVAILABLE", "Company email verification is temporarily unavailable.", status.HTTP_503_SERVICE_UNAVAILABLE)
        if verified is not True:
            return api_error("INVALID_EMAIL_CODE", "The verification code is invalid or expired.", status.HTTP_400_BAD_REQUEST)
        company.email_verified_at = timezone.now()
        company.save(update_fields=["email_verified_at", "updated_at"])
        record_company_event(company, request.user, "COMPANY_EMAIL_VERIFIED")
        return Response({"company": CompanyProfileResponseSerializer(company).data})


class CompanyDocumentUploadView(APIView):
    permission_classes = [IsCompanyAccount]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    @transaction.atomic
    def post(self, request):
        company = CompanyProfile.objects.select_for_update().filter(owner_account=request.user).first()
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if company.activity_state == CompanyActivityState.SUSPENDED:
            return api_error("COMPANY_SUSPENDED", "Company-scoped activity is disabled.", status.HTTP_403_FORBIDDEN)
        if company.verification_state != CompanyVerificationState.PENDING or company.verification_cases.exists():
            return api_error("COMPANY_PROFILE_LOCKED", "Documents cannot be added in this review state.", status.HTTP_409_CONFLICT)
        if (
            not settings.SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES
            or not settings.SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES
            or not settings.SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES
        ):
            return api_error("COMPANY_FILE_POLICY_UNCONFIGURED", "Company document policy is not configured for this environment.", status.HTTP_503_SERVICE_UNAVAILABLE)
        serializer = CompanyDocumentUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        document_type = serializer.validated_data["document_type"]
        if document_type not in settings.SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES:
            return api_error("DOCUMENT_TYPE_NOT_ALLOWED", "This document type is not configured.", status.HTTP_400_BAD_REQUEST)
        uploaded = serializer.validated_data["file"]
        if len(Path(uploaded.name).name) > 255:
            return api_error("INVALID_FILENAME", "The filename is too long.", status.HTTP_400_BAD_REQUEST)
        document = CompanyDocument.objects.create(
            company=company,
            document_type=document_type,
            file=uploaded,
            original_filename=Path(uploaded.name).name,
            content_type=uploaded.content_type,
            size_bytes=uploaded.size,
            uploaded_by=request.user,
        )
        record_company_event(
            company,
            request.user,
            "COMPANY_DOCUMENT_UPLOADED",
            details={"document_id": document.pk, "document_type": document.document_type},
        )
        return Response(
            {"document": CompanyDocumentResponseSerializer(document).data},
            status=status.HTTP_201_CREATED,
        )


class CompanyDocumentDownloadView(APIView):
    permission_classes = [IsCompanyAccount]

    def get(self, request, document_id):
        company = owned_company(request.user)
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        document = get_object_or_404(CompanyDocument, pk=document_id, company=company)
        record_company_event(company, request.user, "COMPANY_DOCUMENT_DOWNLOADED", details={"document_id": document.pk})
        return FileResponse(
            document.file.open("rb"),
            as_attachment=True,
            filename=Path(document.original_filename).name,
            content_type=document.content_type,
            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
        )


class CompanyVerificationSubmissionView(APIView):
    permission_classes = [IsCompanyAccount]

    @transaction.atomic
    def post(self, request):
        company = CompanyProfile.objects.select_for_update().filter(owner_account=request.user).first()
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if company.activity_state == CompanyActivityState.SUSPENDED:
            return api_error("COMPANY_SUSPENDED", "Company-scoped activity is disabled.", status.HTTP_403_FORBIDDEN)
        if not settings.SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES:
            return api_error("COMPANY_VERIFICATION_NOT_CONFIGURED", "Required company documents are not configured.", status.HTTP_503_SERVICE_UNAVAILABLE)
        if not email_ready(company, request):
            return api_error("COMPANY_EMAIL_NOT_VERIFIED", "Verify the company email before submission.", status.HTTP_409_CONFLICT)
        if company.verification_state != CompanyVerificationState.PENDING:
            return api_error("COMPANY_VERIFICATION_LOCKED", "This company is not eligible for a new verification submission.", status.HTTP_409_CONFLICT)
        if company.verification_cases.filter(status=CompanyCaseState.PENDING).exists():
            return api_error("VERIFICATION_ALREADY_PENDING", "A company verification case is already pending.", status.HTTP_409_CONFLICT)
        if company.verification_cases.exists():
            return api_error("COMPANY_REVIEW_REQUIRED", "A prior decision must be reviewed by staff before another submission.", status.HTTP_409_CONFLICT)
        documents = CompanyDocument.objects.filter(company=company, verification_case__isnull=True)
        present_types = set(documents.values_list("document_type", flat=True))
        missing_types = sorted(set(settings.SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES) - present_types)
        if missing_types:
            return Response(
                {"code": "REQUIRED_DOCUMENTS_MISSING", "message": "Upload all configured required documents before submission.", "missing_document_types": missing_types},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            case = CompanyVerificationCase.objects.create(company=company, submitted_by=request.user)
            document_count = documents.count()
            documents.update(verification_case=case)
            record_company_event(
                company,
                request.user,
                "COMPANY_VERIFICATION_SUBMITTED",
                case=case,
                details={"document_count": document_count},
            )
        return Response(
            {"case_id": case.pk, "status": case.status, "submitted_at": case.submitted_at},
            status=status.HTTP_201_CREATED,
        )


class CompanyReviewRequestView(APIView):
    permission_classes = [IsCompanyAccount]

    def post(self, request):
        company = owned_company(request.user)
        if company is None:
            return api_error("COMPANY_NOT_REGISTERED", "Register a company first.", status.HTTP_404_NOT_FOUND)
        if (
            company.activity_state != CompanyActivityState.SUSPENDED
            and company.verification_state != CompanyVerificationState.REJECTED
        ):
            return api_error("REVIEW_NOT_AVAILABLE", "A restricted review request is available for a suspended or rejected company.", status.HTTP_409_CONFLICT)
        serializer = CompanyReviewRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        review_request = CompanyReviewRequest.objects.create(
            company=company,
            submitted_by=request.user,
            reason=serializer.validated_data["reason"],
        )
        record_company_event(
            company,
            request.user,
            "COMPANY_REVIEW_REQUESTED",
            reason=review_request.reason,
            details={"review_request_id": review_request.pk},
        )
        return Response(
            {"id": review_request.pk, "state": review_request.state, "submitted_at": review_request.submitted_at},
            status=status.HTTP_201_CREATED,
        )


class StaffCompanyVerificationQueueView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "REVIEW_COMPANY"

    def get(self, request):
        cases = CompanyVerificationCase.objects.filter(status=CompanyCaseState.PENDING).select_related("company", "assigned_reviewer").prefetch_related("documents")
        return Response({"results": CompanyCaseQueueSerializer(cases, many=True, context={"request": request}).data})


class StaffClaimCompanyVerificationView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "REVIEW_COMPANY"

    def post(self, request, company_id):
        with transaction.atomic():
            company = get_object_or_404(CompanyProfile.objects.select_for_update(), pk=company_id)
            if company.owner_account_id == request.user.pk:
                return api_error("SELF_REVIEW_FORBIDDEN", "Staff cannot review their own company.", status.HTTP_403_FORBIDDEN)
            case = get_object_or_404(
                CompanyVerificationCase.objects.select_for_update(),
                company=company,
                status=CompanyCaseState.PENDING,
            )
            reviewer = staff_profile_for(request.user)
            if case.assigned_reviewer_id and case.assigned_reviewer_id != reviewer.pk:
                return api_error("CASE_ALREADY_ASSIGNED", "This company case is assigned to another reviewer.", status.HTTP_409_CONFLICT)
            if case.assigned_reviewer_id is None:
                case.assigned_reviewer = reviewer
                case.save(update_fields=["assigned_reviewer"])
                record_company_event(company, request.user, "COMPANY_VERIFICATION_ASSIGNED", case=case)
        return Response({"case_id": case.pk, "assigned_reviewer_account_id": request.user.pk})


class StaffCompanyVerificationDecisionView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "REVIEW_COMPANY"

    def post(self, request, company_id):
        serializer = CompanyDecisionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            company = get_object_or_404(CompanyProfile.objects.select_for_update(), pk=company_id)
            if company.owner_account_id == request.user.pk:
                return api_error("SELF_REVIEW_FORBIDDEN", "Staff cannot review their own company.", status.HTTP_403_FORBIDDEN)
            case = get_object_or_404(
                CompanyVerificationCase.objects.select_for_update(),
                company=company,
                status=CompanyCaseState.PENDING,
            )
            if case.assigned_reviewer_id != request.user.pk:
                return api_error("CASE_NOT_ASSIGNED", "Claim this company case before deciding it.", status.HTTP_403_FORBIDDEN)
            decision = serializer.validated_data["decision"]
            reason = serializer.validated_data["reason"]
            case.status = CompanyCaseState.APPROVED if decision == "APPROVE" else CompanyCaseState.REJECTED
            case.reviewed_by = staff_profile_for(request.user)
            case.reviewed_at = timezone.now()
            case.decision_reason = reason
            case.save(update_fields=["status", "reviewed_by", "reviewed_at", "decision_reason"])
            company.verification_state = (
                CompanyVerificationState.VERIFIED if decision == "APPROVE" else CompanyVerificationState.REJECTED
            )
            company.save(update_fields=["verification_state", "updated_at"])
            record_company_event(
                company,
                request.user,
                "COMPANY_VERIFICATION_APPROVED" if decision == "APPROVE" else "COMPANY_VERIFICATION_REJECTED",
                reason=reason,
                case=case,
            )
        return Response({"company": CompanyProfileResponseSerializer(company).data, "case_status": case.status})


class StaffCompanyActionView(APIView):
    action = ""
    target_state = ""
    permission_classes = [HasStaffPermission]

    def post(self, request, company_id):
        serializer = CompanyActionReasonSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            company = get_object_or_404(CompanyProfile.objects.select_for_update(), pk=company_id)
            if company.owner_account_id == request.user.pk:
                return api_error("SELF_REVIEW_FORBIDDEN", "Staff cannot change their own company's activity state.", status.HTTP_403_FORBIDDEN)
            if company.activity_state == self.target_state:
                return api_error("COMPANY_STATE_UNCHANGED", "The company already has the requested activity state.", status.HTTP_409_CONFLICT)
            company.activity_state = self.target_state
            company.save(update_fields=["activity_state", "updated_at"])
            record_company_event(company, request.user, self.action, reason=serializer.validated_data["reason"])
        return Response({"company": CompanyProfileResponseSerializer(company).data})


class StaffSuspendCompanyView(StaffCompanyActionView):
    required_staff_permission = "SUSPEND_COMPANY"
    action = "COMPANY_SUSPENDED"
    target_state = CompanyActivityState.SUSPENDED


class StaffRestoreCompanyView(StaffCompanyActionView):
    required_staff_permission = "RESTORE_COMPANY"
    action = "COMPANY_RESTORED"
    target_state = CompanyActivityState.ACTIVE


class StaffCompanyDocumentDownloadView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "VIEW_PRIVATE_DOCUMENTS"

    def get(self, request, company_id, document_id):
        company = get_object_or_404(CompanyProfile, pk=company_id)
        document = get_object_or_404(CompanyDocument, pk=document_id, company=company)
        if (
            document.verification_case_id is None
            or document.verification_case.assigned_reviewer_id != request.user.pk
        ):
            return api_error("DOCUMENT_NOT_ASSIGNED", "This document is not assigned to this reviewer.", status.HTTP_403_FORBIDDEN)
        record_company_event(company, request.user, "COMPANY_DOCUMENT_DOWNLOADED_BY_STAFF", details={"document_id": document.pk})
        return FileResponse(
            document.file.open("rb"),
            as_attachment=True,
            filename=Path(document.original_filename).name,
            content_type=document.content_type,
            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
        )


class StaffCompanyReviewRequestQueueView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "HANDLE_REVIEW_REQUESTS"

    def get(self, request):
        requests = CompanyReviewRequest.objects.filter(state=CompanyReviewRequestState.OPEN).select_related("company", "submitted_by").order_by("submitted_at", "pk")
        return Response({"results": [
            {
                "id": item.pk,
                "company_id": item.company_id,
                "company_name": item.company.legal_name,
                "verification_state": item.company.verification_state,
                "activity_state": item.company.activity_state,
                "submitted_at": item.submitted_at,
                "reason": item.reason,
            }
            for item in requests
        ]})


class StaffResolveCompanyReviewRequestView(APIView):
    permission_classes = [HasStaffPermission]
    required_staff_permission = "HANDLE_REVIEW_REQUESTS"

    def post(self, request, request_id):
        serializer = CompanyActionReasonSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            review_request = get_object_or_404(CompanyReviewRequest.objects.select_for_update(), pk=request_id)
            if review_request.state != CompanyReviewRequestState.OPEN:
                return api_error("REVIEW_REQUEST_RESOLVED", "This review request is already resolved.", status.HTTP_409_CONFLICT)
            if review_request.company.owner_account_id == request.user.pk:
                return api_error("SELF_REVIEW_FORBIDDEN", "Staff cannot resolve their own company's request.", status.HTTP_403_FORBIDDEN)
            review_request.state = CompanyReviewRequestState.RESOLVED
            review_request.resolved_by = staff_profile_for(request.user)
            review_request.resolved_at = timezone.now()
            review_request.resolution_reason = serializer.validated_data["reason"]
            review_request.save(update_fields=["state", "resolved_by", "resolved_at", "resolution_reason"])
            record_company_event(
                review_request.company,
                request.user,
                "COMPANY_REVIEW_REQUEST_RESOLVED",
                reason=review_request.resolution_reason,
                details={"review_request_id": review_request.pk},
            )
        return Response({"id": review_request.pk, "state": review_request.state})
