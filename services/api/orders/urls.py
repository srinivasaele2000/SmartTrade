from django.urls import path
from . import views
urlpatterns=[
 path('orders',views.BuyerOrders.as_view()),path('orders/<int:pk>',views.BuyerOrderDetail.as_view()),path('orders/<int:pk>/cancel',views.BuyerCancelOrder.as_view()),path('orders/<int:pk>/invoice/download',views.InvoiceDownload.as_view()),
 path('businesses/me/orders',views.DealerOrders.as_view()),path('businesses/me/orders/<int:pk>',views.DealerOrderDetail.as_view()),path('businesses/me/orders/<int:pk>/action',views.DealerOrderAction.as_view()),path('businesses/me/orders/<int:pk>/invoice',views.DealerInvoiceCreate.as_view()),
 path('staff/orders',views.StaffOrders.as_view()),path('staff/orders/<int:pk>',views.StaffOrderDetail.as_view()),
]
