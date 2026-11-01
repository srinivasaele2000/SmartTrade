import re

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.core.exceptions import ValidationError
from django.db import connection, models, transaction
from django.db.models import F, Q
from django.utils import timezone


E164_PATTERN = re.compile(r"^\+[1-9][0-9]{1,14}$")


class AccountType(models.TextChoices):
    PERSONAL = "PERSONAL", "Personal"
    BUSINESS = "BUSINESS", "Business"
    COMPANY = "COMPANY", "Company"
    STAFF = "STAFF", "Staff"


class AccountAccessState(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    BLOCKED = "BLOCKED", "Blocked"


class VerificationState(models.TextChoices):
    PENDING = "PENDING", "Pending"
    VERIFIED = "VERIFIED", "Verified"
    REJECTED = "REJECTED", "Rejected"
    SUSPENDED = "SUSPENDED", "Suspended"


class StaffState(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    DISABLED = "DISABLED", "Disabled"


class AccountManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, mobile_e164, account_type, **extra_fields):
        if not mobile_e164 or not E164_PATTERN.fullmatch(mobile_e164):
            raise ValueError("mobile_e164 must be a canonical E.164 number")
        if account_type not in AccountType.values:
            raise ValueError("account_type is invalid")

        with transaction.atomic(using=self._db):
            account = self.model(
                mobile_e164=mobile_e164,
                account_type=account_type,
                **extra_fields,
            )
            # SmartTrade's initial sign-in flow is provider-verified OTP, not passwords.
            account.set_unusable_password()
            account.save(using=self._db)
            create_account_profile(account)
        return account


class Account(AbstractBaseUser):
    mobile_e164 = models.CharField(max_length=16, unique=True)
    account_type = models.CharField(max_length=10, choices=AccountType.choices)
    access_state = models.CharField(
        max_length=8,
        choices=AccountAccessState.choices,
        default=AccountAccessState.ACTIVE,
    )
    mobile_verified_at = models.DateTimeField(null=True, blank=True)
    token_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AccountManager()

    USERNAME_FIELD = "mobile_e164"
    REQUIRED_FIELDS = []

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(account_type__in=AccountType.values),
                name="account_valid_type",
            ),
            models.CheckConstraint(
                condition=Q(access_state__in=AccountAccessState.values),
                name="account_valid_access_state",
            ),
        ]

    @property
    def is_active(self):
        if self.access_state != AccountAccessState.ACTIVE:
            return False
        if self.account_type == AccountType.STAFF:
            return StaffProfile.objects.filter(
                account_id=self.pk,
                state=StaffState.ACTIVE,
            ).exists()
        return True

    @property
    def is_staff(self):
        return (
            self.account_type == AccountType.STAFF
            and self.is_active
        )

    def save(self, *args, **kwargs):
        if self.pk:
            previous = (
                type(self).objects.filter(pk=self.pk)
                .values("account_type", "access_state", "token_version")
                .first()
            )
            if previous:
                if previous["account_type"] != self.account_type:
                    raise ValidationError({"account_type": "Account type is immutable."})
                if previous["access_state"] != self.access_state:
                    self.token_version = max(
                        self.token_version,
                        previous["token_version"] + 1,
                    )
                    if kwargs.get("update_fields") is not None:
                        kwargs["update_fields"] = set(kwargs["update_fields"]) | {
                            "token_version",
                        }
        super().save(*args, **kwargs)

    def invalidate_tokens(self):
        type(self).objects.filter(pk=self.pk).update(
            token_version=F("token_version") + 1,
        )
        self.refresh_from_db(fields=["token_version"])

    def mark_mobile_verified(self):
        if self.mobile_verified_at is None:
            self.mobile_verified_at = timezone.now()
            self.save(update_fields=["mobile_verified_at"])


class PersonalProfile(models.Model):
    account = models.OneToOneField(
        Account,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="personal_profile",
    )


class BusinessProfile(models.Model):
    legal_name = models.CharField(max_length=200, blank=True)
    registration_number = models.CharField(max_length=100, blank=True)

    account = models.OneToOneField(
        Account,
        on_delete=models.CASCADE,
        related_name="business_profile",
    )
    verification_state = models.CharField(
        max_length=10,
        choices=VerificationState.choices,
        default=VerificationState.PENDING,
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(verification_state__in=VerificationState.values),
                name="business_valid_verification_state",
            ),
        ]


class CompanyUserProfile(models.Model):
    account = models.OneToOneField(
        Account,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="company_user_profile",
    )


class StaffProfile(models.Model):
    account = models.OneToOneField(
        Account,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="staff_profile",
    )
    state = models.CharField(
        max_length=8,
        choices=StaffState.choices,
        default=StaffState.ACTIVE,
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(state__in=StaffState.values),
                name="staff_valid_state",
            ),
        ]

    def save(self, *args, **kwargs):
        previous_state = None
        if self.pk:
            previous_state = (
                type(self).objects.filter(pk=self.pk)
                .values_list("state", flat=True)
                .first()
            )
        with transaction.atomic():
            super().save(*args, **kwargs)
            if (
                previous_state is not None
                and previous_state != self.state
                and connection.vendor != "postgresql"
            ):
                Account.objects.filter(pk=self.account_id).update(
                    token_version=F("token_version") + 1,
                )


class StaffPermission(models.Model):
    code = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=255, blank=True)


class StaffRole(models.Model):
    code = models.CharField(max_length=64, unique=True)
    permissions = models.ManyToManyField(
        StaffPermission,
        through="StaffRolePermission",
        related_name="roles",
    )


class StaffRolePermission(models.Model):
    role = models.ForeignKey(StaffRole, on_delete=models.CASCADE)
    permission = models.ForeignKey(StaffPermission, on_delete=models.PROTECT)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["role", "permission"],
                name="unique_staff_role_permission",
            ),
        ]


class StaffRoleAssignment(models.Model):
    class GrantSource(models.TextChoices):
        STAFF = "STAFF", "Staff action"
        BOOTSTRAP = "BOOTSTRAP", "Controlled bootstrap"

    staff_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="staff_role_assignments",
    )
    role = models.ForeignKey(StaffRole, on_delete=models.PROTECT)
    granted_by = models.ForeignKey(
        Account,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="staff_role_grants_made",
    )
    grant_source = models.CharField(max_length=9, choices=GrantSource.choices)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["staff_account", "role"],
                condition=Q(revoked_at__isnull=True),
                name="unique_active_staff_role_assignment",
            ),
            models.CheckConstraint(
                condition=(
                    Q(grant_source="BOOTSTRAP", granted_by__isnull=True)
                    | Q(grant_source="STAFF", granted_by__isnull=False)
                ),
                name="staff_role_grant_source_actor",
            ),
        ]

    def clean(self):
        errors = {}
        if self.staff_account_id and self.staff_account.account_type != AccountType.STAFF:
            errors["staff_account"] = "Staff roles can only be assigned to staff accounts."
        if self.granted_by_id and self.granted_by.account_type != AccountType.STAFF:
            errors["granted_by"] = "Staff role grants must be made by a staff account."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


def create_account_profile(account):
    profile_by_type = {
        AccountType.PERSONAL: PersonalProfile,
        AccountType.BUSINESS: BusinessProfile,
        AccountType.COMPANY: CompanyUserProfile,
        AccountType.STAFF: StaffProfile,
    }
    profile_by_type[account.account_type].objects.using(account._state.db).create(
        account=account,
    )
