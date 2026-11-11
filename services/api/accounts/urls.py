from django.urls import path
from .dev_auth import DevelopmentLoginView
from .models import AccountType
from .profiles import EmployerSerializer, JobSeekerSerializer, PersonalMe, ServiceProviderSerializer, WorkforceMe
from .views import (
    AccountLoginView,
    AccountLogoutView,
    AccountMeView,
    AccountRegistrationView,
    AccountTokenRefreshView,
    OTPRequestView,
)


urlpatterns = [
    path("personal-profile", PersonalMe.as_view(), name="personal-profile"),
    path("service-provider-profile", WorkforceMe.as_view(
        account_type=AccountType.SERVICE_PROVIDER, serializer_class=ServiceProviderSerializer)),
    path("job-seeker-profile", WorkforceMe.as_view(
        account_type=AccountType.JOB_SEEKER, serializer_class=JobSeekerSerializer)),
    path("employer-profile", WorkforceMe.as_view(
        account_type=AccountType.EMPLOYER, serializer_class=EmployerSerializer)),
    path("dev-login", DevelopmentLoginView.as_view(), name="dev-login"),
    path("register", AccountRegistrationView.as_view(), name="account-register"),
    path("otp/request", OTPRequestView.as_view(), name="otp-request"),
    path("login", AccountLoginView.as_view(), name="account-login"),
    path("refresh", AccountTokenRefreshView.as_view(), name="token-refresh"),
    path("logout", AccountLogoutView.as_view(), name="account-logout"),
    path("me", AccountMeView.as_view(), name="account-me"),
]
