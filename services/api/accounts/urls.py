from django.urls import path
from .dev_auth import DevelopmentLoginView
from .views import (
    AccountLoginView,
    AccountLogoutView,
    AccountMeView,
    AccountRegistrationView,
    AccountTokenRefreshView,
    OTPRequestView,
)


urlpatterns = [
    path("dev-login", DevelopmentLoginView.as_view(), name="dev-login"),
    path("register", AccountRegistrationView.as_view(), name="account-register"),
    path("otp/request", OTPRequestView.as_view(), name="otp-request"),
    path("login", AccountLoginView.as_view(), name="account-login"),
    path("refresh", AccountTokenRefreshView.as_view(), name="token-refresh"),
    path("logout", AccountLogoutView.as_view(), name="account-logout"),
    path("me", AccountMeView.as_view(), name="account-me"),
]
