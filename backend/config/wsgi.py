import logging
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()

# In production Gunicorn loads this module once (preload_app) and forks the workers,
# so warming the models here means every worker starts with them in memory.
if os.getenv("DSS_PRELOAD_MODELS", "false").lower() == "true":
    try:
        from core.services.lab import preload

        preload()
        logging.getLogger(__name__).info("Decision models preloaded.")
    except Exception:  # a missing model must not stop the API; /api/health/ reports it
        logging.getLogger(__name__).warning("Model preload failed; models load on first use.", exc_info=True)
