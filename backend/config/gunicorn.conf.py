"""Gunicorn settings for production. Command-line flags override these values.

    gunicorn config.wsgi:application -c config/gunicorn.conf.py
"""
import os

bind = os.getenv("GUNICORN_BIND", "127.0.0.1:8003")
workers = int(os.getenv("GUNICORN_WORKERS", "2"))

# Load Django and the ML models once in the master process. Workers are forked
# from it and share the model memory (copy-on-write) instead of each loading
# ~100 MB of Random Forests.
preload_app = True

# The decision engine and Model Lab re-tests can take several seconds on a cold cache.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 20
keepalive = 5

# Recycle workers now and then to cap slow memory growth.
max_requests = 1000
max_requests_jitter = 100

forwarded_allow_ips = "127.0.0.1"
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
