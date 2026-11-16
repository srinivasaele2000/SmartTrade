from django.urls import path
from . import client_onboarding, onboarding, views
from .nearby import NearbyBranchCatalogue, NearbyDealers
from .support import AdminInbox, AdminSupport, SupportView
from .banners import AdminBannerReorder, AdminBanners, DealerBanners
from .general_items import GeneralItemDetail, GeneralItems

urlpatterns = [
    path('dealers/general-items/', GeneralItems.as_view()),
    path('dealers/general-items/<int:pk>/', GeneralItemDetail.as_view()),
    path('banners/dealer/', DealerBanners.as_view()),
    path('banners/dealer/<int:pk>/image/', DealerBanners.as_view()),
    path('banners/admin/', AdminBanners.as_view()),
    path('banners/admin/reorder/', AdminBannerReorder.as_view()),
    path('banners/admin/<int:pk>/', AdminBanners.as_view()),
    path('banners/admin/<int:pk>/image/', AdminBanners.as_view(), {'image': True}),
    *[path(f'messages/dealer/{action}/', SupportView.as_view(), {'action': action})
      for action in ('thread', 'messages', 'mark-read', 'unread')],
    path('messages/dealer/attachments/<int:message_id>/', SupportView.as_view(), {'action': 'attachment'}),
    path('messages/admin/threads/', AdminInbox.as_view()),
    path('messages/admin/threads/<int:thread_id>/', AdminSupport.as_view()),
    *[path(f'messages/admin/threads/<int:thread_id>/{action}/', AdminSupport.as_view(), {'action': action})
      for action in ('messages', 'mark-read')],
    path('messages/admin/threads/<int:thread_id>/attachments/<int:message_id>/', AdminSupport.as_view(), {'action': 'attachment'}),
    path('dealers/discover/', NearbyDealers.as_view()),
    path('dealers/discover/<int:branch_id>/catalogue/', NearbyBranchCatalogue.as_view()),
    path('catalogue/items/<int:item_id>/nearby-dealers/', NearbyDealers.as_view()),
    path('auth/dealer/register/', client_onboarding.DealerRegistration.as_view()),
    path('dealers/contacts/batch/', client_onboarding.BatchContacts.as_view()),
    path('admin/dealers/', client_onboarding.DealerDirectory.as_view()),
    path('admin/dealers/<int:pk>/', client_onboarding.DealerDirectoryDetail.as_view()),
    path('admin/dealers/<int:pk>/contacts/', onboarding.StaffContacts.as_view()),
    path('businesses/me/declarations', onboarding.Declarations.as_view()),
    path('businesses/me/declaration-brands', onboarding.DeclarationBrands.as_view()),
    path('businesses/me/brand-suggestions', onboarding.Suggestions.as_view()),
    path('businesses/me/trade-contacts', onboarding.Contacts.as_view()),
    path('businesses/me/trade-contacts/<int:pk>', onboarding.ContactDetail.as_view()),
    path('staff/dealers/businesses/<int:pk>/onboarding', onboarding.StaffOnboarding.as_view()),
    path('staff/dealers/businesses/<int:pk>/brand-suggestions/<int:suggestion_id>/review', onboarding.StaffSuggestionReview.as_view()),
    path('staff/dealers/businesses/<int:pk>/duplicate-review', onboarding.StaffDuplicateReview.as_view()),
    path('staff/dealers/businesses/<int:pk>/trade-contacts', onboarding.StaffContacts.as_view()),
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
