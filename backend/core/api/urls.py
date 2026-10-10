from django.urls import path
from .views import (
    HealthView, MedicineListView, MedicineDetailView, MedicineForecastView,
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
]
