from django.urls import path
from .decision_views import DecisionRunView, DispenseView
from .lab_views import LabActionView, LabModelsView
from .manage_views import (
    BatchDisposeView, BatchEditView, BatchListView, BatchLookupView, DispensePreviewView, DispenseToPatientView,
    MedicineEditView, MedicineListView as CatalogueMedicineListView, OfferEditView, OfferListView,
    SupplierEditView, SupplierManageListView, UserEditView, UserListView,
)
from .views import (
    HealthView, MedicineListView, MedicineDetailView, MedicineForecastView, MedicineTransactionsView, SearchView,
    InventoryView, InventoryDetailView, InventoryHealthView, InventoryTrendView, ExpiryRiskView, StockMovementView,
    RecommendationListView, RecommendationDetailView, RecommendationActionView,
    SupplierListView, SupplierPerformanceView, DashboardView, InsightView,
    NotificationView, NotificationReadView, ReportView
)

urlpatterns = [
    path("health/", HealthView.as_view()),
    path("medicines/", MedicineListView.as_view()),
    path("medicines/<int:pk>/", MedicineDetailView.as_view()),
    path("medicines/<int:pk>/forecast/", MedicineForecastView.as_view()),
    path("medicines/<int:pk>/transactions/", MedicineTransactionsView.as_view()),
    path("search/", SearchView.as_view()),
    path("inventory/", InventoryView.as_view()),
    path("inventory/health/", InventoryHealthView.as_view()),
    path("inventory/trend/", InventoryTrendView.as_view()),
    path("inventory/expiry-risk/", ExpiryRiskView.as_view()),
    path("inventory/movements/", StockMovementView.as_view()),
    path("inventory/<int:pk>/", InventoryDetailView.as_view()),
    path("recommendations/", RecommendationListView.as_view()),
    path("recommendations/<uuid:pk>/", RecommendationDetailView.as_view()),
    path("recommendations/<uuid:pk>/<str:action>/", RecommendationActionView.as_view()),
    path("suppliers/", SupplierListView.as_view()),
    path("suppliers/<int:pk>/performance/", SupplierPerformanceView.as_view()),
    path("dashboard/kpis/", DashboardView.as_view()),
    path("dashboard/insights/", InsightView.as_view()),
    path("notifications/", NotificationView.as_view()),
    path("notifications/<int:pk>/read/", NotificationReadView.as_view()),
    path("notifications/read-all/", NotificationView.as_view()),
    path("reports/generate/", ReportView.as_view()),
    path("decisions/run/", DecisionRunView.as_view()),
    path("decisions/dispense/", DispenseView.as_view()),
    # Record management (medicines, suppliers, offers, batches with expiry, users)
    path("manage/medicines/", CatalogueMedicineListView.as_view()),
    path("manage/medicines/<int:pk>/", MedicineEditView.as_view()),
    path("manage/suppliers/", SupplierManageListView.as_view()),
    path("manage/suppliers/<int:pk>/", SupplierEditView.as_view()),
    path("manage/offers/", OfferListView.as_view()),
    path("manage/offers/<int:pk>/", OfferEditView.as_view()),
    path("manage/users/", UserListView.as_view()),
    path("manage/users/<int:pk>/", UserEditView.as_view()),
    path("batches/", BatchListView.as_view()),
    path("batches/lookup/", BatchLookupView.as_view()),
    path("batches/<int:pk>/", BatchEditView.as_view()),
    path("batches/<int:pk>/dispose/", BatchDisposeView.as_view()),
    # Patient dispensing: expired and quarantined stock is never given out
    path("dispense/preview/", DispensePreviewView.as_view()),
    path("dispense/", DispenseToPatientView.as_view()),
    path("lab/models/", LabModelsView.as_view()),
    path("lab/<str:model>/<str:action>/", LabActionView.as_view()),
]
