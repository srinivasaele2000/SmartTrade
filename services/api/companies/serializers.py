from django.conf import settings
from rest_framework import serializers

from .models import CompanyDocument, CompanyProfile, CompanyVerificationCase
from .email_verification import development_verified


class CompanyRegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyProfile
        fields = (
            "legal_name",
            "trading_name",
            "registration_number",
            "tax_registration_number",
            "authorized_person_name",
            "company_email",
            "address_line",
            "pin_code",
            "area",
            "district",
            "state_or_region",
            "website",
        )


class CompanyProfileResponseSerializer(serializers.ModelSerializer):
    can_publish_catalogue = serializers.BooleanField(read_only=True)

    class Meta:
        model = CompanyProfile
        fields = (
            "id",
            "legal_name",
            "trading_name",
            "registration_number",
            "tax_registration_number",
            "authorized_person_name",
            "company_email",
            "email_verified_at",
            "address_line",
            "pin_code",
            "area",
            "district",
            "state_or_region",
            "website",
            "verification_state",
            "activity_state",
            "can_publish_catalogue",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class CompanyEmailCodeSerializer(serializers.Serializer):
    code = serializers.CharField(write_only=True, trim_whitespace=True, max_length=256)

    def validate_code(self, value):
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value


class CompanyDocumentUploadSerializer(serializers.Serializer):
    document_type = serializers.RegexField(regex=r"^[A-Z0-9_]{1,64}$")
    file = serializers.FileField()

    def validate_file(self, uploaded):
        max_bytes = getattr(settings, "SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES", None)
        allowed_types = getattr(settings, "SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES", ())
        if not max_bytes or not allowed_types:
            raise serializers.ValidationError(
                "Company document uploads are not configured for this environment."
            )
        if uploaded.size <= 0 or uploaded.size > max_bytes:
            raise serializers.ValidationError("The file is empty or exceeds the configured limit.")

        mime_to_signature = {
            "application/pdf": (".pdf", b"%PDF-"),
            "image/jpeg": (".jpg", b"\xff\xd8\xff"),
            "image/png": (".png", b"\x89PNG\r\n\x1a\n"),
        }
        content_type = (getattr(uploaded, "content_type", "") or "").lower()
        signature_rule = mime_to_signature.get(content_type)
        if content_type not in allowed_types or signature_rule is None:
            raise serializers.ValidationError("The uploaded file type is not allowed.")
        expected_extension, signature = signature_rule
        if uploaded.name.lower().rsplit(".", 1)[-1] != expected_extension.lstrip("."):
            raise serializers.ValidationError("The file extension does not match its content type.")
        header = uploaded.read(len(signature))
        uploaded.seek(0)
        if not header.startswith(signature):
            raise serializers.ValidationError("The file contents do not match the declared type.")
        return uploaded


class CompanyDocumentResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyDocument
        fields = ("id", "document_type", "original_filename", "content_type", "size_bytes", "uploaded_at")
        read_only_fields = fields


class CompanyReviewDocumentSerializer(serializers.ModelSerializer):
    """Non-file metadata shown to authorized verification reviewers."""

    class Meta:
        model = CompanyDocument
        fields = ("id", "document_type", "original_filename", "content_type", "size_bytes", "uploaded_at")
        read_only_fields = fields


class CompanyCaseQueueSerializer(serializers.ModelSerializer):
    email_verification_mode = serializers.SerializerMethodField()

    def get_email_verification_mode(self, case):
        if case.company.email_verified_at:
            return "provider_verified"
        return "development_simulated" if development_verified(case.company, self.context.get("request")) else "unverified"

    company_id = serializers.IntegerField(read_only=True)
    legal_name = serializers.CharField(source="company.legal_name", read_only=True)
    company_email = serializers.EmailField(source="company.company_email", read_only=True)
    assigned_reviewer_account_id = serializers.IntegerField(
        source="assigned_reviewer.account_id",
        read_only=True,
        allow_null=True,
    )
    document_types = serializers.SerializerMethodField()
    company = CompanyProfileResponseSerializer(read_only=True)
    documents = CompanyReviewDocumentSerializer(many=True, read_only=True)

    class Meta:
        model = CompanyVerificationCase
        fields = (
            "id",
            "company_id",
            "legal_name",
            "company_email",
            "status",
            "submitted_at",
            "assigned_reviewer_account_id",
            "document_types",
            "email_verification_mode",
            "company",
            "documents",
        )

    def get_document_types(self, case):
        return list(case.documents.order_by("document_type").values_list("document_type", flat=True))


class CompanyDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=("APPROVE", "REJECT"))
    reason = serializers.CharField(trim_whitespace=True, max_length=4000)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A review reason is required.")
        return value


class CompanyActionReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(trim_whitespace=True, max_length=4000)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A reason is required.")
        return value


class CompanyReviewRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(trim_whitespace=True, max_length=4000)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A review request reason is required.")
        return value
