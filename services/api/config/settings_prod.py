"""Production settings for the SmartTrade container deployment."""
from .settings import *  # noqa: F403


def csv_env(name):
    return [part.strip() for part in os.environ.get(name, "").split(",") if part.strip()]


DEBUG = False
ALLOWED_HOSTS = csv_env("ALLOWED_HOSTS")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise RuntimeError("Set ALLOWED_HOSTS to the explicit production IP or domain.")
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith("replace-"):
    raise RuntimeError("Set DJANGO_SECRET_KEY to a generated production secret of at least 50 characters.")

INSTALLED_APPS = [*INSTALLED_APPS, "corsheaders"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
]
CORS_ALLOWED_ORIGINS = csv_env("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = csv_env("CSRF_TRUSTED_ORIGINS")
STATIC_URL = "/static/"

DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.environ.get("POSTGRES_DB", "smarttrade"),
    "USER": os.environ.get("POSTGRES_USER", "smarttrade"),
    "PASSWORD": os.environ["POSTGRES_PASSWORD"],
    "HOST": os.environ.get("POSTGRES_HOST", "db"),
    "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    "CONN_MAX_AGE": 60,
    "CONN_HEALTH_CHECKS": True,
}}

USE_HTTPS = os.environ.get("USE_HTTPS", "false").lower() in {"1", "true", "yes"}
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = USE_HTTPS
SESSION_COOKIE_SECURE = USE_HTTPS
CSRF_COOKIE_SECURE = USE_HTTPS
SECURE_HSTS_SECONDS = 31536000 if USE_HTTPS else 0

SMARTTRADE_ENABLE_DEV_AUTH = False
SMARTTRADE_ENABLE_DEV_OTP = False
SMARTTRADE_ENABLE_DEV_EMAIL = False
SMARTTRADE_SERVE_PUBLIC_CATALOGUE_MEDIA = True
