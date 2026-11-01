from django.urls import include, path

urlpatterns = [
    path("api/v1/auth/", include("accounts.urls")),
    path("api/v1/", include("companies.urls")),
    path("api/v1/", include("catalogue.urls")),
    path("api/v1/", include("dealers.urls")),
    path("api/v1/", include("health.urls")),
]
