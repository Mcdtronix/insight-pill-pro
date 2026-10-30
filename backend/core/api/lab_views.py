"""Model Lab endpoints: interact with, explain and re-test each decision model.

GET  /api/lab/models/                          model cards from the exported metadata
GET  /api/lab/<model>/context/?...             realistic inputs taken from the database
POST /api/lab/<model>/predict/                 run the model on submitted inputs
GET  /api/lab/<model>/evaluate/?...            re-score the model on its held-out test data
"""
import logging
from datetime import date

from rest_framework.response import Response
from rest_framework.views import APIView

from core.services import lab

log = logging.getLogger(__name__)


def _int(params, key, default=None):
    try:
        return int(params.get(key, default))
    except (TypeError, ValueError):
        raise lab.LabInputError({key: ["Enter a whole number."]})


def _date(params, key):
    try:
        return date.fromisoformat(params.get(key, ""))
    except ValueError:
        raise lab.LabInputError({key: ["Enter a date as YYYY-MM-DD."]})


def _float_or_none(params, key):
    raw = params.get(key)
    if raw in (None, ""):
        return None
    try:
        value = float(raw)
    except ValueError:
        raise lab.LabInputError({key: ["Enter a number."]})
    if not 0 < value < 1:
        raise lab.LabInputError({key: ["Must be between 0 and 1."]})
    return value


ACTIONS = {
    ("demand", "context", "GET"): lambda r: lab.demand_context(_int(r.query_params, "medicine"), _date(r.query_params, "date")),
    ("demand", "predict", "POST"): lambda r: lab.demand_predict(r.data),
    ("demand", "evaluate", "GET"): lambda r: lab.demand_evaluate(_int(r.query_params, "medicine", 6)),
    ("reorder", "context", "GET"): lambda r: lab.reorder_context(_int(r.query_params, "medicine")),
    ("reorder", "predict", "POST"): lambda r: lab.reorder_predict(r.data),
    ("reorder", "evaluate", "GET"): lambda r: lab.reorder_evaluate(_float_or_none(r.query_params, "threshold")),
    ("supplier", "predict", "POST"): lambda r: lab.supplier_score(r.data),
    ("supplier", "evaluate", "GET"): lambda r: lab.supplier_evaluate(),
    ("expiry", "context", "GET"): lambda r: lab.expiry_context(),
    ("expiry", "predict", "POST"): lambda r: lab.expiry_predict(r.data),
    ("expiry", "evaluate", "GET"): lambda r: lab.expiry_evaluate(),
}


class LabModelsView(APIView):
    required_permission = "forecast.view"

    def get(self, request):
        return Response(lab.model_cards())


class LabActionView(APIView):
    required_permission = "forecast.view"

    def _run(self, request, model, action):
        handler = ACTIONS.get((model, action, request.method))
        if handler is None:
            return Response({"code": "not_found", "detail": "Unknown lab action."}, status=404)
        try:
            return Response(handler(request))
        except lab.LabInputError as e:
            return Response({"code": "validation_error", "detail": "Please correct the highlighted fields.",
                             "fields": e.fields}, status=400)
        except FileNotFoundError as e:
            return Response({"code": "model_unavailable", "detail": str(e)}, status=503)
        except Exception:
            log.exception("Model Lab action failed: %s/%s", model, action)
            return Response({"code": "lab_error", "detail": "The model could not process this request."}, status=500)

    def get(self, request, model, action):
        return self._run(request, model, action)

    def post(self, request, model, action):
        return self._run(request, model, action)
