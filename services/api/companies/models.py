import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.models import AccountType, StaffProfile


class CompanyVerificationState(models.TextChoices):
    PENDING = "PENDING", "Pending"
    VERIFIED = "VERIFIED", "Verified"
    REJECTED = "REJECTED", "Rejected"


class CompanyActivityState(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    SUSPENDED = "SUSPENDED", "Suspended"


class CompanyCaseState(models.TextChoices):
    PENDING = "PENDING", "Pending review"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class CompanyReviewRequestState(models.TextChoices):
    OPEN = "OPEN", "Open"
    RESOLVED = "RESOLVED", "Resolved"


def company_document_upload_path(instance, filename):
    extension = Path(filename).suffix.lower()
    if len(extension) > 10:
        extension = ""
    return f"private/company-documents/{instance.company_id}/{uuid.uuid4().hex}{extension}"


class CompanyProfile(models.Model):
    owner_account = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_company",
    )
    legal_name = models.CharField(max_length=200)
    trading_name = models.CharField(max_length=200, blank=True)
    registration_number = models.CharField(max_length=100, blank=True)
    tax_registration_number = models.CharField(max_length=100, blank=True)
    authorized_person_name = models.CharField(max_length=200, blank=True)
    company_email = models.EmailField()
    email_verified_at = models.DateTimeField(null=True, blank=True)
    address_line = models.CharField(max_length=300, blank=True)
    pin_code = models.CharField(max_length=16, blank=True)
    area = models.CharField(max_length=120, blank=True)
    district = models.CharField(max_length=120, blank=True)
    state_or_region = models.CharField(max_length=120, blank=True)
    website = models.URLField(blank=True)
    verification_state = models.CharField(
        max_length=10,
        choices=CompanyVerificationState.choices,
        default=CompanyVerificationState.PENDING,
    )
    activity_state = models.CharField(
        max_length=9,
        choices=CompanyActivityState.choices,
        default=CompanyActivityState.ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(verification_state__in=CompanyVerificationState.values),
                name="company_valid_verification_state",
            ),
            models.CheckConstraint(
                condition=Q(activity_state__in=CompanyActivityState.values),
                name="company_valid_activity_state",
            ),
        ]

    def clean(self):
        if self.owner_account_id and self.owner_account.account_type != AccountType.COMPANY:
            raise ValidationError({"owner_account": "A company must be owned by a COMPANY account."})

    @property
    def can_publish_catalogue(self):
        return (
            self.verification_state == CompanyVerificationState.VERIFIED
            and self.activity_state == CompanyActivityState.ACTIVE
            and self.owner_account.is_active
        )

    @property
    def public_catalogue_visible(self):
        return self.can_publish_catalogue

    def save(self, *args, **kwargs):
        if self.pk:
            previous_owner_id = type(self).objects.filter(pk=self.pk).values_list(
                "owner_account_id", flat=True
            ).first()
            if previous_owner_id is not None and previous_owner_id != self.owner_account_id:
                raise ValidationError({"owner_account": "Company ownership transfer is not supported."})
        self.full_clean()
        super().save(*args, **kwargs)


class CompanyVerificationCase(models.Model):
    company = models.ForeignKey(
        CompanyProfile,
        on_delete=models.PROTECT,
        related_name="verification_cases",
    )
    status = models.CharField(
        max_length=8,
        choices=CompanyCaseState.choices,
        default=CompanyCaseState.PENDING,
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="company_verification_submissions",
    )
    submitted_at = models.DateTimeField(default=timezone.now)
    reviewed_by = models.ForeignKey(
        StaffProfile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="company_verification_reviews",
    )
    assigned_reviewer = models.ForeignKey(
        StaffProfile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="assigned_company_verification_cases",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=CompanyCaseState.values),
                name="company_case_valid_status",
            ),
            models.UniqueConstraint(
                fields=["company"],
                condition=Q(status=CompanyCaseState.PENDING),
                name="company_one_pending_verification_case",
            ),
        ]


class CompanyDocument(models.Model):
    company = models.ForeignKey(
        CompanyProfile,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    verification_case = models.ForeignKey(
        CompanyVerificationCase,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    document_type = models.CharField(max_length=64)
    file = models.FileField(upload_to=company_document_upload_path)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=127)
    size_bytes = models.PositiveBigIntegerField()
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_company_documents",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(size_bytes__gt=0), name="company_document_nonempty"),
        ]


class CompanyAuditEvent(models.Model):
    company = models.ForeignKey(
        CompanyProfile,
        on_delete=models.PROTECT,
        related_name="audit_events",
    )
    verification_case = models.ForeignKey(
        CompanyVerificationCase,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="company_audit_events",
    )
    action = models.CharField(max_length=64)
    reason = models.TextField(blank=True)
    details = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Audit events are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit events cannot be deleted.")


class CompanyReviewRequest(models.Model):
    company = models.ForeignKey(
        CompanyProfile,
        on_delete=models.PROTECT,
        related_name="review_requests",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="company_review_requests",
    )
    reason = models.TextField()
    state = models.CharField(max_length=8, choices=CompanyReviewRequestState.choices, default=CompanyReviewRequestState.OPEN)
    submitted_at = models.DateTimeField(auto_now_add=True)
    resolved_by = models.ForeignKey(
        StaffProfile,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="resolved_company_review_requests",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(state__in=CompanyReviewRequestState.values),
                name="company_review_request_valid_state",
            ),
        ]
