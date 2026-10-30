"""Decision engine endpoints.

POST /api/decisions/run/       run all four models for every medicine; save recommendations
     body: {"medicineIds": [model ids]} optional, to limit the run
POST /api/decisions/dispense/  what-if: dispense units first-expiry-first-out
     body: {"medicineId": model id, "quantity": units}
"""
import logging

from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Medicine
from core.services import engine

log = logging.getLogger(__name__)


class DecisionRunView(APIView):
    required_permission = "recommendations.view"

    def post(self, request):
        ids = request.data.get("medicineIds")
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, int) for i in ids)):
            return Response({"code": "validation_error", "fields": {"medicineIds": ["Send a list of medicine ids."]}},
                            status=400)
        try:
            return Response(engine.run(model_ids=ids, user=request.user, save=True))
        except FileNotFoundError as e:
            return Response({"code": "model_unavailable", "detail": str(e)}, status=503)


class DispenseView(APIView):
    required_permission = "inventory.edit"

    def post(self, request):
        try:
            model_id = int(request.data.get("medicineId"))
            qty = int(request.data.get("quantity"))
        except (TypeError, ValueError):
            return Response({"code": "validation_error", "detail": "Send a medicine and a whole-number quantity."},
                            status=400)
        if qty < 1:
            return Response({"code": "validation_error", "fields": {"quantity": ["Quantity must be at least 1."]}},
                            status=400)
        if not Medicine.objects.filter(model_id=model_id).exists():
            return Response({"code": "validation_error", "fields": {"medicineId": ["Unknown medicine."]}}, status=400)
        try:
            return Response(engine.dispense(model_id, qty, request.user), status=201)
        except ValueError as e:
            return Response({"code": "insufficient_stock", "detail": str(e)}, status=409)
