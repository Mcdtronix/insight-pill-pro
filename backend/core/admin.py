from django.contrib import admin
from .models import (
    Medicine, Supplier, SupplierOffer, Batch, DataState, StockMovement,
    DailyDemand, CalendarDay, SupplierDelivery, Policy, DecisionSnapshot,
    Recommendation, PurchaseOrder, Notification, AuditEvent, Report, ImportRun,
)

admin.site.site_header = "Pharmacy Decision Support Administration"
admin.site.site_title = "Pharmacy DSS Admin"
admin.site.index_title = "Operational control centre"

class ReadOnlyOperationalAdmin(admin.ModelAdmin):
    """Evidence and model-output records are immutable from the admin UI."""
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False

@admin.register(Medicine)
class MedicineAdmin(admin.ModelAdmin):
    list_display = ("name", "model_id", "category", "strength", "form", "active")
    list_filter = ("category", "active", "form")
    search_fields = ("name", "category", "model_id")
    ordering = ("name",)
    list_per_page = 50

@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "external_id", "status", "contact_email", "phone")
    list_filter = ("status",)
    search_fields = ("name", "external_id", "contact_email", "phone")
    list_per_page = 50

@admin.register(SupplierOffer)
class SupplierOfferAdmin(admin.ModelAdmin):
    list_display = ("medicine", "supplier", "unit_cost", "lead_time_days", "pack_size", "minimum_order", "active")
    list_filter = ("active", "supplier")
    search_fields = ("medicine__name", "supplier__name")
    autocomplete_fields = ("medicine", "supplier")
    list_select_related = ("medicine", "supplier")

@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ("number", "medicine", "quantity", "received_at", "expiry_date", "quarantined", "source")
    list_filter = ("quarantined", "source", "expiry_date")
    search_fields = ("number", "medicine__name")
    autocomplete_fields = ("medicine", "supplier")
    list_select_related = ("medicine", "supplier")
    date_hierarchy = "expiry_date"

@admin.register(Policy)
class PolicyAdmin(admin.ModelAdmin):
    list_display = ("id", "lead_time_buffer", "service_level", "expiry_window", "review_period", "version")
    readonly_fields = ("id",)

@admin.register(DataState)
class DataStateAdmin(ReadOnlyOperationalAdmin):
    list_display = ("id", "revision")

@admin.register(StockMovement)
class StockMovementAdmin(ReadOnlyOperationalAdmin):
    list_display = ("occurred_at", "batch", "kind", "quantity", "actor", "reason", "key")
    list_filter = ("kind", "occurred_at")
    search_fields = ("batch__number", "batch__medicine__name", "reason", "fingerprint")
    autocomplete_fields = ("batch", "actor")
    list_select_related = ("batch", "actor")
    date_hierarchy = "occurred_at"

@admin.register(DailyDemand)
class DailyDemandAdmin(ReadOnlyOperationalAdmin):
    list_display = ("date", "medicine", "quantity", "stockout", "complete", "holiday", "season", "source")
    list_filter = ("stockout", "complete", "holiday", "season", "source", "date")
    search_fields = ("medicine__name",)
    date_hierarchy = "date"

@admin.register(CalendarDay)
class CalendarDayAdmin(admin.ModelAdmin):
    list_display = ("date", "holiday", "season")
    list_filter = ("holiday", "season")
    date_hierarchy = "date"

@admin.register(SupplierDelivery)
class SupplierDeliveryAdmin(ReadOnlyOperationalAdmin):
    list_display = ("source_key", "supplier", "medicine", "order_date", "promised_date", "actual_date", "ordered", "delivered", "rejected")
    list_filter = ("supplier", "order_date", "actual_date")
    search_fields = ("source_key", "supplier__name", "medicine__name")
    autocomplete_fields = ("supplier", "medicine")
    list_select_related = ("supplier", "medicine")
    date_hierarchy = "order_date"

@admin.register(DecisionSnapshot)
class DecisionSnapshotAdmin(ReadOnlyOperationalAdmin):
    list_display = ("kind", "subject", "as_of", "signature", "created_at")
    list_filter = ("kind", "as_of")
    search_fields = ("kind", "subject", "signature")

@admin.register(Recommendation)
class RecommendationAdmin(ReadOnlyOperationalAdmin):
    list_display = ("medicine", "status", "quantity", "unit_cost", "as_of", "decided_by", "created_at")
    list_filter = ("status", "as_of", "created_at")
    search_fields = ("medicine__name", "reason")
    autocomplete_fields = ("medicine", "offer", "decided_by")
    list_select_related = ("medicine", "offer", "decided_by")

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(ReadOnlyOperationalAdmin):
    list_display = ("id", "offer", "quantity", "received_units", "rejected_units", "status", "placed_at", "expected_at", "created_by")
    list_filter = ("status", "placed_at", "expected_at")
    search_fields = ("id", "offer__medicine__name", "offer__supplier__name")
    autocomplete_fields = ("recommendation", "offer", "created_by")
    list_select_related = ("offer", "created_by")

@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "kind", "severity", "title", "read")
    list_filter = ("kind", "severity", "read", "created_at")
    search_fields = ("user__username", "user__email", "title", "message")
    autocomplete_fields = ("user",)
    list_select_related = ("user",)

@admin.register(AuditEvent)
class AuditEventAdmin(ReadOnlyOperationalAdmin):
    list_display = ("created_at", "actor", "action", "entity")
    list_filter = ("action", "entity", "created_at")
    search_fields = ("actor__username", "action", "entity")
    autocomplete_fields = ("actor",)
    list_select_related = ("actor",)

@admin.register(Report)
class ReportAdmin(ReadOnlyOperationalAdmin):
    list_display = ("created_at", "owner", "kind", "format", "row_count")
    list_filter = ("kind", "format", "created_at")
    search_fields = ("owner__username", "kind")
    autocomplete_fields = ("owner",)
    list_select_related = ("owner",)

@admin.register(ImportRun)
class ImportRunAdmin(ReadOnlyOperationalAdmin):
    list_display = ("created_at", "name", "rows", "digest")
    list_filter = ("name", "created_at")
    search_fields = ("name", "digest")
