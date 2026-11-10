from django.urls import path
from .media import StaffProductMedia
from .views import OwnerBrand, StaffBrands, StaffCategory, StaffCatalogueAudit, Categories, ModerateProduct, OwnerCatalogue, OwnerProduct, OwnerVariant, OwnerVariants, PublicBrands, PublicProduct, PublicProducts, StaffCategories, StaffProducts

urlpatterns = [
    *[path(f'staff/catalogue/products/<int:pk>/{kind}', StaffProductMedia.as_view(), {'kind': kind})
      for kind in ('image', 'catalogue-pdf')],
    path('companies/me/catalogue/brands/<int:pk>', OwnerBrand.as_view()),
    path('staff/catalogue/brands', StaffBrands.as_view()),
    path('staff/catalogue/categories/<int:pk>', StaffCategory.as_view()),
    path('staff/catalogue/audit', StaffCatalogueAudit.as_view()),
    path('catalogue/products', PublicProducts.as_view()),
    path('catalogue/products/<int:pk>', PublicProduct.as_view()),
    path('catalogue/brands', PublicBrands.as_view()),
    path('catalogue/categories', Categories.as_view()),
    path('staff/catalogue/categories', StaffCategories.as_view()),
    path('staff/catalogue/products', StaffProducts.as_view()),
    path('staff/catalogue/products/<int:pk>/moderation', ModerateProduct.as_view()),
    *[path(f'companies/me/catalogue/{resource}', OwnerCatalogue.as_view(), {'resource': resource}) for resource in ('brands', 'brand-categories', 'products')],
    path('companies/me/catalogue/products/<int:pk>', OwnerProduct.as_view()),
    path('companies/me/catalogue/products/<int:pk>/variants', OwnerVariants.as_view()),
    path('companies/me/catalogue/products/<int:pk>/variants/<int:variant_id>', OwnerVariant.as_view()),
]
