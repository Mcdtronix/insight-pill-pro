from django.test import TestCase
from rest_framework.test import APIClient
from .models import User

class AuthenticationValidationTests(TestCase):
    def setUp(self):
        User.objects.create_user(username="qa@example.com", email="qa@example.com", password="Correct!123")
        self.client=APIClient()
    def test_invalid_email_is_explicit(self):
        response=self.client.post("/api/auth/login/", {"email":"not-an-email","password":"x"}, format="json")
        self.assertEqual(response.status_code,400)
        self.assertEqual(response.json()["fields"]["email"],["Email is not valid."])
    def test_wrong_password_is_explicit(self):
        response=self.client.post("/api/auth/login/", {"email":"qa@example.com","password":"Wrong!123"}, format="json")
        self.assertEqual(response.status_code,401)
        self.assertEqual(response.json()["fields"]["password"],["Wrong password."])
    def test_unknown_email_is_explicit(self):
        response=self.client.post("/api/auth/login/", {"email":"missing@example.com","password":"Correct!123"}, format="json")
        self.assertEqual(response.status_code,401)
        self.assertEqual(response.json()["fields"]["email"],["Email is not valid."])


class LoginThrottleTests(TestCase):
    """Found during Chapter 5 testing: the 10-per-minute login limit was configured but never enforced."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        # This test fills the limit on purpose; empty it afterwards for the tests that follow.
        self.addCleanup(cache.clear)

    def test_eleventh_attempt_in_a_minute_is_blocked(self):
        client = APIClient()
        codes = [client.post("/api/auth/login/", {"email": "nobody@t.test", "password": "x"}, format="json").status_code
                 for _ in range(11)]
        self.assertEqual(codes[:10], [401] * 10)
        self.assertEqual(codes[10], 429)
