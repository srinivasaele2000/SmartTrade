from rest_framework.permissions import BasePermission


class IsActiveAccount(BasePermission):
    message = "This account cannot access protected resources."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and getattr(user, "is_active", False)
        )
