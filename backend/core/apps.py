import os
import sys
import threading

from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        # Warm the ML models in the background when the dev server starts, so the
        # first prediction in a demo is instant. Skipped for migrate, tests, etc.
        # With the autoreloader, only the child process (RUN_MAIN=true) serves requests.
        serving = "runserver" in sys.argv and (os.environ.get("RUN_MAIN") == "true" or "--noreload" in sys.argv)
        if serving:
            threading.Thread(target=self._preload, name="model-preload", daemon=True).start()

    @staticmethod
    def _preload():
        import logging
        try:
            from core.services.lab import preload
            preload()
            logging.getLogger(__name__).info("Decision models preloaded.")
        except Exception:
            logging.getLogger(__name__).warning("Model preload failed; models will load on first use.", exc_info=True)
