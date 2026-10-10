import logging
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"


class ModelUnavailable(APIException):
    status_code = 503
    default_code = "model_unavailable"


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        return Response({"code": "invalid_request", "detail": str(exc)}, status=400)
    if isinstance(exc, IntegrityError):
        logging.getLogger(__name__).warning("Database constraint rejected a request", exc_info=True)
        return Response({"code": "conflict", "detail": "This operation conflicts with existing records."}, status=409)
    response = drf_handler(exc, context)
    if response is not None:
        data = response.data
        response.data = {"code": getattr(exc, "default_code", "request_failed"),
                         "detail": data.get("detail", "Some fields were not accepted.") if isinstance(data, dict) else "Request rejected.",
                         "fieldErrors": data if isinstance(data, dict) and "detail" not in data else {}}
    return response
