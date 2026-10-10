from rest_framework.permissions import BasePermission

PERMISSIONS = {
    "admin": {"inventory.view", "inventory.edit", "forecast.view", "recommendations.view", "recommendations.approve", "suppliers.view", "suppliers.edit", "expiry.view", "reports.view", "settings.manage", "audit.view"},
    "manager": {"inventory.view", "inventory.edit", "forecast.view", "recommendations.view", "recommendations.approve", "suppliers.view", "suppliers.edit", "expiry.view", "reports.view"},
    "pharmacist": {"inventory.view", "forecast.view", "recommendations.view", "expiry.view", "reports.view"},
    "staff": {"inventory.view", "expiry.view"},
}


def can(user, permission):
    return user.is_authenticated and user.is_active and (user.is_superuser or permission in PERMISSIONS.get(user.role, set()))


class RolePermission(BasePermission):
    def has_permission(self, request, view):
        required = getattr(view, "required_permission", None)
        if required is None:
            return bool(request.user and request.user.is_authenticated and request.user.is_active)
        if isinstance(required, dict):
            required = required.get(request.method)
        return required is not None and can(request.user, required)
