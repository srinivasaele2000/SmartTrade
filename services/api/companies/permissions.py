from rest_framework.permissions import BasePermission

from accounts.models import AccountType, StaffRoleAssignment, StaffState


class IsCompanyAccount(BasePermission):
    message = "A COMPANY account is required."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.account_type == AccountType.COMPANY
            and request.user.is_active
        )


class HasStaffPermission(BasePermission):
    message = "This staff account does not have the required permission."

    def has_permission(self, request, view):
        account = request.user
        permission_code = getattr(view, "required_staff_permission", None)
        if not (
            permission_code
            and account
            and account.is_authenticated
            and account.account_type == AccountType.STAFF
            and account.is_active
            and account.staff_profile.state == StaffState.ACTIVE
        ):
            return False
        return StaffRoleAssignment.objects.filter(
            staff_account=account,
            revoked_at__isnull=True,
            role__permissions__code=permission_code,
        ).exists()
