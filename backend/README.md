# Pharmacy DSS backend

This is a Django 5.2 API for the existing React frontend. It uses PostgreSQL in production and SQLite for local development. The supplied Colab model artifacts are loaded read-only from `MODEL_ROOT` and are never accepted as user uploads.

## Local run

From the repository root:

```powershell
& .\.ml-review.local\Scripts\python.exe -m pip install -r backend\requirements.txt
& .\.ml-review.local\Scripts\python.exe backend\manage.py migrate
& .\.ml-review.local\Scripts\python.exe backend\manage.py createsuperuser
& .\.ml-review.local\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
```

The frontend should call `http://127.0.0.1:8000/api`. Create a user with an email as the username; `POST /api/auth/login/` returns JWT access and refresh tokens. Invalid email syntax returns a field error stating “Email is not valid.” An incorrect password returns “Wrong password.” Passwords are never logged or echoed.

## Administration

Open `http://127.0.0.1:8000/admin/` and sign in with the superuser created by `createsuperuser`. The **Users** screen lets an administrator create accounts, set email and name, assign one of the pharmacy roles (Administrator, Manager, Pharmacist, or Staff), activate or disable access, and manage staff/superuser privileges. Passwords are entered through Django’s password form and stored as hashes.

All domain models are registered. Medicines, suppliers, offers, batches, policies, and calendar data are editable. Stock movements, demand history, supplier delivery history, recommendations, purchase orders, audit events, reports, imports, and model snapshots are intentionally read-only in Admin so operational history cannot be rewritten outside the transactional API.

## API boundaries

Every protected endpoint requires JWT authentication and a role permission. Operational stock writes are transactional, require an idempotency key, reject zero quantities and overselling, and return explicit 4xx errors. Forecasts return 422 when the required 30 complete demand days are absent and 503 when the reviewed artifact is unavailable. CSV inventory reports are generated in memory and returned as a download.

The demand adapter implements the reviewed v1 feature contract and marks recursive multi-day forecasts as unvalidated. Expiry risk is a rule-based FEFO service because no expiry model artifact was supplied.

For production, set `DJANGO_DEBUG=false`, provide a strong `DJANGO_SECRET_KEY`, configure PostgreSQL, and run behind HTTPS. Do not use the SQLite database or `DSS_DEMO_DATE` in production.
