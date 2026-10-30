"""Small, explicit adapters for the reviewed Colab artifacts.

Artifacts are loaded from MODEL_ROOT and never accepted from an HTTP upload.
Missing artifacts or insufficient history return a clear 503/422 to callers.
"""
import json, pickle, joblib
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
import numpy as np
import pandas as pd
from django.conf import settings
from django.utils import timezone
from core.models import DailyDemand

def _path(folder, name): return Path(settings.MODEL_ROOT) / folder / name
@lru_cache(maxsize=8)
def _load(folder,name):
    p=_path(folder,name)
    if not p.exists(): raise FileNotFoundError(f"Model artifact is missing: {p.name}")
    try:
        obj = joblib.load(p)
    except Exception:
        with p.open("rb") as f: obj = pickle.load(f)
    # Single-row predictions are ~3x faster without thread start-up cost (Windows especially).
    if hasattr(obj, "n_jobs"): obj.n_jobs = 1
    return obj
def demand_forecast(medicine, horizon):
    model=_load("Demand","forecast_model_v1.pkl"); cat=_load("Demand","category_encoder_v1.pkl"); season=_load("Demand","season_encoder_v1.pkl")
    rows=list(DailyDemand.objects.filter(medicine=medicine, complete=True).order_by("date").values("date","quantity","holiday","season"))
    if len(rows)<30: raise ValueError("At least 30 complete consecutive demand days are required for a forecast.")
    vals=[float(r["quantity"]) for r in rows[-30:]]; result=[]; last=rows[-1]["date"]
    category=cat.transform([medicine.category])[0]; season_name=rows[-1]["season"] or "Transition Season"; season_code=season.transform([season_name])[0]
    for i in range(1,min(int(horizon),90)+1):
        d=last+timedelta(days=i); lag=lambda n: vals[-n] if len(vals)>=n else vals[0]
        window7=vals[-7:]; window30=vals[-30:]
        x=np.array([[medicine.model_id or medicine.id,category,season_code,d.weekday(),d.month,int(d.weekday()>=5),0,lag(1),lag(7),lag(14),lag(30),np.mean(window7),np.mean(window30),np.std(window7,ddof=1) if len(window7)>1 else 0]],dtype=float)
        if hasattr(model, "feature_names_in_"): x=pd.DataFrame(x, columns=model.feature_names_in_)
        y=max(0.0,float(model.predict(x)[0])); vals.append(y); result.append({"date":d.isoformat(),"quantity":round(y,2),"modelVersion":"Demand v1","validatedHorizon":False})
    return result
