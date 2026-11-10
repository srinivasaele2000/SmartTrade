from django.urls import include, path
from catalogue.media import public_media

urlpatterns = [
    path("media/catalogue/<uuid:key>", public_media, name="catalogue-media"),
    path("api/v1/auth/", include("accounts.urls")),
    path("api/v1/", include("companies.urls")),
    path("api/v1/", include("catalogue.urls")),
    path("api/v1/", include("dealers.urls")),
    path("api/v1/", include("enquiries.urls")),
    path("api/v1/", include("orders.urls")),
    path("api/v1/", include("health.urls")),
]
