"""Development settings for the SmartTrade API foundation."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set; see the root .env.example.")

DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() in {"1", "true", "yes"}
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "accounts.apps.AccountsConfig",
    "companies.apps.CompaniesConfig",
    "catalogue",
    "dealers",
    "health",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {},
}]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DB_ENGINE = os.environ.get("DB_ENGINE", "postgresql").lower()
if DB_ENGINE == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("DB_NAME", "smarttrade"),
            "USER": os.environ.get("DB_USER", "smarttrade"),
            "PASSWORD": os.environ.get("DB_PASSWORD", ""),
            "HOST": os.environ.get("DB_HOST", "localhost"),
            "PORT": os.environ.get("DB_PORT", "5432"),
            "CONN_MAX_AGE": 60,
        }
    }
elif DB_ENGINE == "sqlite":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get("SQLITE_PATH", str(BASE_DIR / "local.sqlite3")),
        }
    }
else:
    raise RuntimeError("DB_ENGINE must be either 'postgresql' or 'sqlite'.")

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
MEDIA_ROOT = os.environ.get("PRIVATE_FILE_STORAGE_ROOT") or str(BASE_DIR / "private_uploads")
FILE_UPLOAD_PERMISSIONS = 0o600
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o700
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.AccountJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.IsActiveAccount"],
    "EXCEPTION_HANDLER": "accounts.exceptions.safe_api_exception_handler",
}

AUTH_USER_MODEL = "accounts.Account"
SMARTTRADE_OTP_PROVIDER = os.environ.get("SMARTTRADE_OTP_PROVIDER", "").strip()
SMARTTRADE_COMPANY_EMAIL_PROVIDER = os.environ.get("SMARTTRADE_COMPANY_EMAIL_PROVIDER", "").strip()

_company_document_max_bytes = os.environ.get("SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES", "").strip()
try:
    SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES = int(_company_document_max_bytes) if _company_document_max_bytes else None
except ValueError as exc:
    raise RuntimeError("SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES must be an integer.") from exc
if SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES is not None and SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES <= 0:
    raise RuntimeError("SMARTTRADE_COMPANY_DOCUMENT_MAX_BYTES must be greater than zero.")

SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES = tuple(
    value.strip().lower()
    for value in os.environ.get("SMARTTRADE_COMPANY_DOCUMENT_ALLOWED_TYPES", "").split(",")
    if value.strip()
)
SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES = tuple(
    value.strip().upper()
    for value in os.environ.get("SMARTTRADE_COMPANY_REQUIRED_DOCUMENT_TYPES", "").split(",")
    if value.strip()
)

# Opt-in, local-only development authentication; never enabled by default.
SMARTTRADE_ENABLE_DEV_AUTH = os.environ.get("SMARTTRADE_ENABLE_DEV_AUTH", "false").lower() in {"1", "true", "yes"}
SMARTTRADE_DEV_AUTH_STAFF_ID = os.environ.get("SMARTTRADE_DEV_AUTH_STAFF_ID", "").strip()

SMARTTRADE_ENABLE_DEV_OTP = os.environ.get("SMARTTRADE_ENABLE_DEV_OTP", "false").lower() in {"1", "true", "yes"}

# Local simulation never establishes real email ownership.
SMARTTRADE_ENABLE_DEV_EMAIL = os.getenv("SMARTTRADE_ENABLE_DEV_EMAIL", "false").lower() == "true"
