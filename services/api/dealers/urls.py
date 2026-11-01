from django.urls import path
from . import views

urlpatterns = [
    path('staff/dealers/listing-audit', views.StaffListingAudit.as_view()),
    path('companies/me/dealers', views.CompanyDealerSearch.as_view()),
    path('staff/dealers/authorizations', views.StaffAuthorizations.as_view()),
    path('staff/dealers/authorization-audit', views.StaffAuthorizationAudit.as_view()),
    path('businesses/me', views.BusinessMe.as_view()),
    path('businesses/me/locations', views.Locations.as_view()),
    path('businesses/me/locations/<int:pk>', views.LocationDetail.as_view()),
    path('businesses/me/listings', views.Listings.as_view()),
    path('businesses/me/listings/<int:pk>', views.ListingDetail.as_view()),
    path('companies/me/dealer-authorizations', views.CompanyGrants.as_view()),
    path('dealers/listings', views.Discovery.as_view()),
    path('dealers/listings/<int:pk>', views.DiscoveryDetail.as_view()),
    path('staff/dealers/businesses', views.StaffBusinesses.as_view()),
    path('staff/dealers/businesses/<int:pk>/decision', views.StaffBusinessDecision.as_view()),
    path('staff/dealers/locations', views.StaffLocations.as_view()),
    path('staff/dealers/locations/<int:pk>/moderation', views.StaffLocationModeration.as_view()),
    path('staff/dealers/listings', views.StaffListings.as_view()),
]
