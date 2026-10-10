from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrator"
        MANAGER = "manager", "Manager"
        PHARMACIST = "pharmacist", "Pharmacist"
        STAFF = "staff", "Staff"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    alert_preferences = models.JSONField(default=dict, blank=True)
