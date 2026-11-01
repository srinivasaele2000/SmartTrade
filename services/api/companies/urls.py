from django.urls import path

from .views import (
    CompanyDocumentDownloadView,
    CompanyDocumentUploadView,
    CompanyEmailVerificationConfirmView,
    CompanyEmailVerificationRequestView,
    CompanyMeView,
    CompanyRegistrationView,
    CompanyReviewRequestView,
    CompanyVerificationSubmissionView,
    StaffCompanyDocumentDownloadView,
    StaffCompanyReviewRequestQueueView,
    StaffClaimCompanyVerificationView,
    StaffCompanyVerificationDecisionView,
    StaffCompanyVerificationQueueView,
    StaffResolveCompanyReviewRequestView,
    StaffRestoreCompanyView,
    StaffSuspendCompanyView,
)


urlpatterns = [
    path("companies/register", CompanyRegistrationView.as_view(), name="company-register"),
    path("companies/me", CompanyMeView.as_view(), name="company-me"),
    path("companies/me/email-verification/request", CompanyEmailVerificationRequestView.as_view(), name="company-email-request"),
    path("companies/me/email-verification/confirm", CompanyEmailVerificationConfirmView.as_view(), name="company-email-confirm"),
    path("companies/me/documents", CompanyDocumentUploadView.as_view(), name="company-document-upload"),
    path("companies/me/documents/<int:document_id>", CompanyDocumentDownloadView.as_view(), name="company-document-download"),
    path("companies/me/verification-submissions", CompanyVerificationSubmissionView.as_view(), name="company-verification-submit"),
    path("companies/me/review-requests", CompanyReviewRequestView.as_view(), name="company-review-request"),
    path("staff/companies/verification-queue", StaffCompanyVerificationQueueView.as_view(), name="staff-company-verification-queue"),
    path("staff/companies/<int:company_id>/claim", StaffClaimCompanyVerificationView.as_view(), name="staff-company-verification-claim"),
    path("staff/companies/<int:company_id>/verification-decision", StaffCompanyVerificationDecisionView.as_view(), name="staff-company-verification-decision"),
    path("staff/companies/<int:company_id>/suspend", StaffSuspendCompanyView.as_view(), name="staff-company-suspend"),
    path("staff/companies/<int:company_id>/restore", StaffRestoreCompanyView.as_view(), name="staff-company-restore"),
    path("staff/companies/<int:company_id>/documents/<int:document_id>", StaffCompanyDocumentDownloadView.as_view(), name="staff-company-document-download"),
    path("staff/companies/review-requests", StaffCompanyReviewRequestQueueView.as_view(), name="staff-company-review-request-queue"),
    path("staff/companies/review-requests/<int:request_id>/resolve", StaffResolveCompanyReviewRequestView.as_view(), name="staff-company-review-request-resolve"),
]
