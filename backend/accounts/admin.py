from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserCreationForm
from django import forms
from .models import User

class PharmacyUserCreationForm(UserCreationForm):
    username = forms.EmailField(label="Email address", help_text="Use the staff member's work email address.")

    class Meta:
        model = User
        fields = ("username", "first_name", "last_name", "role")

@admin.register(User)
class PharmacyUserAdmin(UserAdmin):
    add_form = PharmacyUserCreationForm
    list_display = ("username", "email", "first_name", "last_name", "role", "is_active", "is_staff", "last_login")
    list_filter = ("role", "is_active", "is_staff", "is_superuser", "date_joined")
    search_fields = ("username", "email", "first_name", "last_name")
    ordering = ("username",)
    list_per_page = 50
    fieldsets = UserAdmin.fieldsets + (("Pharmacy", {"fields": ("role", "alert_preferences")}),)
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("username", "first_name", "last_name", "role", "password1", "password2")} ),
    )

    def save_model(self, request, obj, form, change):
        """Keep the admin's normal password hashing workflow and audit actor fields."""
        if not change and not obj.email:
            obj.email = obj.username
        super().save_model(request, obj, form, change)
