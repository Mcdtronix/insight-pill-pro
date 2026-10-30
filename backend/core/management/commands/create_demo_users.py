"""Create one demonstration account per role.

Usage:
    python manage.py create_demo_users                   # password from DEMO_USER_PASSWORD
    python manage.py create_demo_users --password "..."  # explicit password

Accounts: admin@pgh.demo, manager@pgh.demo, pharmacist@pgh.demo, staff@pgh.demo.
Existing demo accounts get their role and password reset. Other users are untouched.
"""
import os

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User

DEMO_USERS = [
    ("admin@pgh.demo", "Tendai", "Moyo", User.Role.ADMIN),
    ("manager@pgh.demo", "Rutendo", "Chikwanha", User.Role.MANAGER),
    ("pharmacist@pgh.demo", "Farai", "Ncube", User.Role.PHARMACIST),
    ("staff@pgh.demo", "Tatenda", "Dube", User.Role.STAFF),
]


class Command(BaseCommand):
    help = "Create or reset one demo user for each role (admin, manager, pharmacist, staff)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Password for all demo users (default: DEMO_USER_PASSWORD).")

    def handle(self, *args, **opts):
        password = opts.get("password") or os.getenv("DEMO_USER_PASSWORD", "")
        if not password:
            raise CommandError("Set DEMO_USER_PASSWORD in backend/.env or pass --password.")
        try:
            validate_password(password)
        except ValidationError as e:
            raise CommandError("Password rejected: " + " ".join(e.messages))

        for email, first, last, role in DEMO_USERS:
            user, created = User.objects.get_or_create(username=email, defaults={"email": email})
            user.email, user.first_name, user.last_name, user.role = email, first, last, role
            user.is_active = True
            user.is_staff = role == User.Role.ADMIN
            user.set_password(password)
            user.save()
            self.stdout.write(f"  {'Created' if created else 'Reset  '} {email:<22} role={role}")
        self.stdout.write(self.style.SUCCESS("Demo users ready. The password is the value of DEMO_USER_PASSWORD."))
