from django.urls import path
from .views import BillPDF, Bills, ConvertToBill, EstimateDetail, EstimatePDF, Estimates

urlpatterns = [
    path('dealers/estimates/', Estimates.as_view()),
    path('dealers/estimates/<int:pk>/', EstimateDetail.as_view()),
    path('dealers/estimates/<int:pk>/pdf/', EstimatePDF.as_view()),
    path('dealers/estimates/<int:pk>/convert-to-bill/', ConvertToBill.as_view()),
    path('dealers/bills/', Bills.as_view()),
    path('dealers/bills/<int:pk>/pdf/', BillPDF.as_view()),
]
