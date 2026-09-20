"""Dataset discovery, preprocessing, demand prediction, and diagnostics."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
MAPPING_PATH = DATA_DIR / "column_mapping.json"
DATASET_PATH = DATA_DIR / "dataset.csv"
MODEL_DIR = ROOT / "models"
_TRAINING_CACHE: dict[str, Any] = {}


def _mapping() -> dict[str, Any]:
    return json.loads(MAPPING_PATH.read_text(encoding="utf-8"))


def load_dataset() -> tuple[pd.DataFrame, dict[str, Any]]:
    mapping = _mapping()
    if not DATASET_PATH.exists():
        return pd.DataFrame(), {"status": "not_supplied", "message": "No dataset.csv was supplied.", "columns": [], "rows": 0, "resolved_columns": {}}
    try:
        frame = pd.read_csv(DATASET_PATH)
    except Exception as error:
        return pd.DataFrame(), {"status": "unreadable", "message": str(error), "columns": [], "rows": 0, "resolved_columns": {}}
    frame = frame.drop_duplicates().copy()
    frame.columns = [str(column).strip() for column in frame.columns]
    resolved = {}
    lowered = {column.lower(): column for column in frame.columns}
    for canonical, aliases in mapping["aliases"].items():
        for alias in aliases:
            if alias.lower() in lowered:
                resolved[canonical] = lowered[alias.lower()]
                break
    for canonical, source in resolved.items():
        if canonical in {"timestamp", "arrival_time", "charging_start_time", "charging_end_time"}:
            frame[source] = pd.to_datetime(frame[source], errors="coerce")
        elif canonical not in {"station_id", "weather_condition"}:
            frame[source] = pd.to_numeric(frame[source], errors="coerce")
    start = resolved.get("charging_start_time")
    end = resolved.get("charging_end_time")
    if "charging_duration" not in resolved and start and end:
        duration = (frame[end] - frame[start]).dt.total_seconds() / 60
        frame["__derived_charging_duration_minutes"] = duration
        resolved["charging_duration"] = "__derived_charging_duration_minutes"
    return frame, {"status": "loaded", "message": "Dataset loaded, normalized, and duplicate rows removed.", "filename": DATASET_PATH.name, "columns": list(frame.columns), "rows": len(frame), "resolved_columns": resolved, "dtypes": {column: str(value) for column, value in frame.dtypes.items()}}


def diagnostics() -> dict[str, Any]:
    frame, info = load_dataset()
    missing = {column: int(frame[column].isna().sum()) for column in frame.columns} if not frame.empty else {}
    station_column = info.get("resolved_columns", {}).get("station_id")
    return {**info, "missing_values": missing, "target": _target_column(info.get("resolved_columns", {})), "station_count": int(frame[station_column].nunique()) if station_column and not frame.empty else 0}


def _target_column(resolved: dict[str, str]) -> str | None:
    return resolved.get("charging_demand") or resolved.get("energy_consumed_kWh") or resolved.get("station_load") or resolved.get("queue_length")


def target_definition(resolved: dict[str, str]) -> dict[str, str | None]:
    candidates = [("charging_demand", resolved.get("charging_demand")), ("energy_consumed_kWh", resolved.get("energy_consumed_kWh")), ("station_load", resolved.get("station_load")), ("queue_length", resolved.get("queue_length"))]
    canonical, source = next(((name, column) for name, column in candidates if column), (None, None))
    return {"concept": canonical, "source_column": source}


def station_demand_summary() -> dict[str, Any]:
    trained = train_demand_model()
    if trained["status"] != "evaluated":
        return {"status": trained["status"], "target": trained.get("target"), "stations": [], "diagnostics": trained.get("diagnostics")}
    station_column = trained["resolved"]["station_id"]
    predictions = trained["predictions"].copy()
    predictions[station_column] = trained["frame"].loc[predictions.index, station_column].astype(str)
    grouped = predictions.groupby(station_column)["prediction"].mean().reset_index()
    return {"status": "evaluated", "target": trained["target"], "stations": [{"station_id": str(row[station_column]), "predicted_demand": round(float(row["prediction"]), 4), "source": "Random Forest station-level prediction mean"} for _, row in grouped.iterrows()]}


def _training_features(frame: pd.DataFrame, resolved: dict[str, str], target: str) -> pd.DataFrame:
    features = pd.DataFrame(index=frame.index)
    timestamp = resolved.get("timestamp")
    if timestamp:
        features["start_hour"] = frame[timestamp].dt.hour
        features["start_day_of_week"] = frame[timestamp].dt.dayofweek
    for canonical in ["battery_capacity_kWh", "initial_soc", "distance_driven", "vehicle_age"]:
        source = resolved.get(canonical)
        if source:
            features[canonical] = pd.to_numeric(frame[source], errors="coerce")
    for canonical in ["station_id", "station_location", "vehicle_model", "time_of_day", "day_of_week", "charger_type", "user_type"]:
        source = resolved.get(canonical)
        if source:
            features = pd.concat([features, pd.get_dummies(frame[source].astype("string"), prefix=canonical, dummy_na=True)], axis=1)
    features = features.replace([np.inf, -np.inf], np.nan).fillna(0)
    return features.drop(columns=[target], errors="ignore")


def train_demand_model() -> dict[str, Any]:
    if not DATASET_PATH.exists():
        return {"status": "not_evaluated", "target": {"concept": None, "source_column": None}, "diagnostics": "No dataset.csv was supplied."}
    cache_key = str(DATASET_PATH.stat().st_mtime_ns)
    if _TRAINING_CACHE.get("cache_key") == cache_key:
        return _TRAINING_CACHE["result"]
    frame, info = load_dataset()
    resolved = info.get("resolved_columns", {})
    target = _target_column(resolved)
    definition = target_definition(resolved)
    if frame.empty or not target:
        return {"status": "not_evaluated", "target": definition, "diagnostics": "A supported demand target was not found in the supplied CSV."}
    usable = frame.dropna(subset=[target]).copy()
    if len(usable) < 10:
        return {"status": "not_evaluated", "target": definition, "diagnostics": "At least 10 non-null target observations are required."}
    features = _training_features(usable, resolved, target)
    if features.shape[1] == 0:
        return {"status": "not_evaluated", "target": definition, "diagnostics": "No valid pre-session predictor columns were found."}
    split = max(1, int(len(usable) * 0.8))
    if split >= len(usable):
        split = len(usable) - 1
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    model = RandomForestRegressor(n_estimators=200, random_state=42, min_samples_leaf=2, n_jobs=-1)
    model.fit(features.iloc[:split], usable[target].iloc[:split])
    predicted = model.predict(features.iloc[split:])
    actual = usable[target].iloc[split:]
    denominator = np.where(np.abs(actual) < 1e-9, np.nan, np.abs(actual))
    mape = float(np.nanmean(np.abs((actual - predicted) / denominator)) * 100) if np.isfinite(denominator).any() else None
    metrics = {"rmse": round(float(np.sqrt(mean_squared_error(actual, predicted))), 4), "mae": round(float(mean_absolute_error(actual, predicted)), 4), "mape": round(mape, 4) if mape is not None else None, "r2": round(float(r2_score(actual, predicted)), 4), "train_rows": split, "test_rows": len(actual), "feature_count": features.shape[1]}
    all_predictions = pd.Series(model.predict(features), index=usable.index, name="prediction")
    MODEL_DIR.mkdir(exist_ok=True)
    import joblib
    joblib.dump({"model": model, "features": list(features.columns), "target": target, "metrics": metrics}, MODEL_DIR / "demand_random_forest.joblib")
    result = {"status": "evaluated", "target": definition, "metrics": metrics, "frame": usable, "resolved": resolved, "predictions": pd.DataFrame({"prediction": all_predictions}), "model": model, "features": features, "diagnostics": "Random Forest trained with a chronological 80/20 split using pre-session/contextual features only."}
    _TRAINING_CACHE["cache_key"] = cache_key
    _TRAINING_CACHE["result"] = result
    return result


def predict_demand(payload: dict[str, Any]) -> dict[str, Any]:
    trained = train_demand_model()
    station_id = payload.get("station_id")
    if trained["status"] != "evaluated":
        return {"status": trained["status"], "predicted_demand": None, "station_id": station_id, "prediction_horizon": payload.get("horizon", "next hour"), "target": trained.get("target"), "diagnostics": trained.get("diagnostics")}
    return {"status": "evaluated", "predicted_demand": round(float(trained["predictions"]["prediction"].iloc[-1]), 4), "station_id": station_id, "prediction_horizon": payload.get("horizon", "next hour"), "target": trained["target"], "metrics": trained["metrics"], "diagnostics": trained["diagnostics"]}
