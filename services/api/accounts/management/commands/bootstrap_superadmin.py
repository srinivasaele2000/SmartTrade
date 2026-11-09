from getpass import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from accounts.models import (
    Account,
    AccountType,
    StaffPermission,
    StaffRole,
    StaffRoleAssignment,
    StaffRolePermission,
)
from config.india import INDIAN_MOBILE_PATTERN


INITIAL_ADMIN_PERMISSIONS = (
    "MANAGE_STAFF",
    "REVIEW_BUSINESS",
    "REVIEW_TRADE_CONTACTS",
    "REVIEW_COMPANY",
    "HANDLE_REVIEW_REQUESTS",
    "VIEW_PRIVATE_DOCUMENTS",
    "MANAGE_TAXONOMY",
    "MODERATE_PRODUCTS",
    "SUSPEND_COMPANY",
    "RESTORE_COMPANY",
    "READ_AUDIT",
    "READ_REPORTS",
)


class Command(BaseCommand):
    help = "Provision the first staff super-admin from a controlled local shell."

    def handle(self, *args, **options):
        mobile = getpass("Initial staff mobile in +91XXXXXXXXXX format: ")
        account = self.provision(mobile)
        self.stdout.write(self.style.SUCCESS(
            f"Provisioned staff account ID {account.pk}. Mobile verification remains pending."
        ))

    def provision(self, mobile):
        if not INDIAN_MOBILE_PATTERN.fullmatch(mobile):
            raise CommandError("Use a valid Indian mobile number in +91XXXXXXXXXX format.")

        try:
            with transaction.atomic():
                role, _ = StaffRole.objects.get_or_create(code="PLATFORM_ADMIN")
                role = StaffRole.objects.select_for_update().get(pk=role.pk)
                if StaffRoleAssignment.objects.filter(
                    role=role,
                    revoked_at__isnull=True,
                ).exists():
                    raise CommandError("An active platform admin already exists.")
                if Account.objects.filter(mobile_e164=mobile).exists():
                    raise CommandError("That mobile number already belongs to an account.")

                account = Account.objects.create_user(
                    mobile_e164=mobile,
                    account_type=AccountType.STAFF,
                )
                permissions = [
                    StaffPermission.objects.get_or_create(code=code)[0]
                    for code in INITIAL_ADMIN_PERMISSIONS
                ]
                StaffRolePermission.objects.bulk_create(
                    [
                        StaffRolePermission(role=role, permission=permission)
                        for permission in permissions
                    ],
                    ignore_conflicts=True,
                )
                StaffRoleAssignment.objects.create(
                    staff_account=account,
                    role=role,
                    grant_source=StaffRoleAssignment.GrantSource.BOOTSTRAP,
                )
        except IntegrityError as exc:
            raise CommandError("Could not provision the initial staff account.") from exc

        return account
