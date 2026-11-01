from rest_framework.views import exception_handler


def safe_api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    original = response.data
    if isinstance(original, dict):
        original = dict(original)
        detail = original.pop("detail", None)
        original.pop("code", None)
        field_errors = original
    else:
        detail = None
        field_errors = {"non_field_errors": original}

    status_codes = {
        400: "VALIDATION_ERROR",
        401: "AUTHENTICATION_REQUIRED",
        403: "PERMISSION_DENIED",
        404: "NOT_FOUND",
        429: "RATE_LIMITED",
    }
    error_code = status_codes.get(response.status_code, "REQUEST_FAILED")
    exception_code = getattr(exc, "default_code", "")
    if response.status_code == 401 and exception_code in {
        "invalid_token",
        "token_not_valid",
    }:
        error_code = "INVALID_TOKEN"
    elif response.status_code == 401 and exception_code == "user_inactive":
        error_code = "ACCOUNT_BLOCKED"
    response.data = {
        "code": error_code,
        "message": str(detail) if detail is not None else "Request validation failed.",
        "field_errors": field_errors,
    }
    return response
