from django.urls import path
from . import views

urlpatterns = [
    path('enquiries', views.BuyerEnquiries.as_view()),
    path('enquiries/<int:pk>', views.BuyerEnquiryDetail.as_view()),
    path('enquiries/<int:pk>/response', views.BuyerQuotationResponse.as_view()),
    path('businesses/me/enquiries', views.DealerEnquiries.as_view()),
    path('businesses/me/enquiries/<int:pk>', views.DealerEnquiryDetail.as_view()),
    path('businesses/me/enquiries/<int:pk>/decline', views.DealerDecline.as_view()),
    path('businesses/me/enquiries/<int:pk>/quotations', views.DealerQuotations.as_view()),
    path('staff/enquiries', views.StaffEnquiries.as_view()),
    path('staff/enquiries/<int:pk>', views.StaffEnquiryDetail.as_view()),
]
