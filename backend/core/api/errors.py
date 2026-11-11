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
        fields = data if isinstance(data, dict) and "detail" not in data else {}
        detail = data.get("detail") if isinstance(data, dict) else None
        if detail is None:
            # Lead with the first specific message ("This stock is already expired…"),
            # not a generic one, so every API client gets a useful sentence.
            detail = _first_message(fields) or "Some fields were not accepted."
        response.data = {"code": getattr(exc, "default_code", "request_failed"), "detail": str(detail),
                         "fieldErrors": fields}
    return response


def _first_message(value):
    if isinstance(value, dict):
        for item in value.values():
            found = _first_message(item)
            if found:
                return found
    elif isinstance(value, (list, tuple)):
        for item in value:
            found = _first_message(item)
            if found:
                return found
    elif value:
        return str(value)
    return None
