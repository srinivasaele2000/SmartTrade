from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class AccountJWTAuthentication(JWTAuthentication):
    """Validate account state and token version on every API request."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result and (result[1].get("dev_auth") or result[1].get("dev_otp")):
            from .dev_auth import local_request
            if not local_request(request):
                raise AuthenticationFailed("Development authentication requires loopback.")
        return result

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        token_version = validated_token.get("token_version")
        if token_version is None or token_version != user.token_version:
            raise AuthenticationFailed(
                "Invalid or revoked authentication token.",
                code="invalid_token",
            )
        from .dev_auth import development_token_allowed
        if not development_token_allowed(user, validated_token):
            raise AuthenticationFailed("Development authentication is disabled.", code="invalid_token")
        return user
