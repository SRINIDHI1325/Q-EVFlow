"""FastAPI application for Q-EVFlow's local ML and optimization workloads."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from optimization.classical_solver import solve_classically
from optimization.qaoa_solver import solve_qaoa
from app.services.clustering import cluster_stations
from app.services.data_service import diagnostics, predict_demand, station_demand_summary
from app.services.recommendation import rank_stations
from app.services.simulation import calculate_eta, load_simulation

app = FastAPI(title="Q-EVFlow ML Service", version="1.0.0")


class EtaRequest(BaseModel):
    current_node: str = "origin-a"
    station_id: str
    traffic_level: str = "low"
    required_energy_kwh: float = Field(default=24, ge=0)
    charging_power_kw: float | None = Field(default=None, gt=0)
    queue_length: int | None = Field(default=None, ge=0)


class DemandRequest(BaseModel):
    station_id: str | None = None
    horizon: str = "next hour"


class RecommendationRequest(BaseModel):
    ev: dict[str, Any]
    stations: list[dict[str, Any]] | None = None


class OptimizationRequest(BaseModel):
    evs: list[dict[str, Any]] | None = None
    stations: list[dict[str, Any]] | None = None
    traffic_level: str = "low"


def _stations() -> list[dict[str, Any]]:
    _, station_config, _ = load_simulation()
    configured = station_config.get("stations", [])
    summary = station_demand_summary()
    if summary["status"] != "evaluated":
        return cluster_stations(configured)
    by_id = {item["station_id"]: item["predicted_demand"] for item in summary["stations"]}
    updated = [{**station, "predicted_demand": by_id.get(station["id"], station.get("predicted_demand")), "demand_provenance": "dataset-derived" if station["id"] in by_id else "simulated configuration"} for station in configured]
    return cluster_stations(updated)


def _evs() -> list[dict[str, Any]]:
    _, _, config = load_simulation()
    return config.get("simulated_evs", [])


def _optimization_problem(evs: list[dict[str, Any]], stations: list[dict[str, Any]], traffic_level: str) -> dict[str, Any]:
    _, _, config = load_simulation()
    routes = []
    for ev in evs:
        for station in stations:
            route = calculate_eta({"current_node": ev.get("current_node", "origin-a"), "station_id": station["id"], "required_energy_kwh": ev.get("required_energy_kwh", 24), "traffic_level": traffic_level})
            routes.append({"ev_id": ev["id"], "station_id": station["id"], **route})
    return {"evs": evs, "stations": stations, "routes": routes, "time_slots": config.get("time_slots", []), "slot_duration_minutes": config.get("default_time_slot_minutes", 30), "grid_power_kw": config.get("grid_power_kw", 180), "max_quantum_variables": config.get("max_quantum_variables", 12), "weights": {"distance": 1.0, "eta": 0.7, "waiting": 1.1, "demand": 0.15, "congestion": 0.5, "charging_power": 0.05, "peak_load": 1.0, "assignment_penalty": 1000.0, "capacity_penalty": 1000.0, "invalid_penalty": 2000.0}}


@app.get("/health")
def health() -> dict[str, Any]:
    info = diagnostics()
    return {"status": "ok", "service": "ml-service", "dataset": info["status"], "message": info["message"]}


@app.get("/stations")
def stations() -> dict[str, Any]:
    summary = station_demand_summary()
    dataset_stations = [{"id": item["station_id"], "name": item["station_id"], "predicted_demand": item["predicted_demand"], "demand_provenance": "dataset-derived"} for item in summary.get("stations", [])]
    return {"stations": _stations(), "dataset_station_clusters": cluster_stations(dataset_stations) if dataset_stations else [], "dataset_station_count": diagnostics().get("station_count", len(dataset_stations)), "dataset_clusterable_station_count": len(dataset_stations), "source": "simulation configuration for routing; dataset-derived station clusters when available"}


@app.get("/evs")
def evs() -> dict[str, Any]:
    return {"evs": _evs(), "source": "local simulation configuration"}


@app.post("/eta")
def eta(request: EtaRequest) -> dict[str, Any]:
    try:
        return calculate_eta(request.model_dump(exclude_none=True))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/ml/predict-demand")
def demand(request: DemandRequest) -> dict[str, Any]:
    return predict_demand(request.model_dump())


@app.get("/ml/metrics")
def metrics() -> dict[str, Any]:
    info = diagnostics()
    prediction = predict_demand({})
    return {"dataset": info, "model": {"status": prediction["status"], "target": prediction.get("target"), **prediction.get("metrics", {"rmse": None, "mae": None, "mape": None, "r2": None})}}


@app.post("/ml/cluster-stations")
def clusters(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    items = (payload or {}).get("stations")
    if not items:
        summary = station_demand_summary()
        items = [{"id": item["station_id"], "station_id": item["station_id"], "predicted_demand": item["predicted_demand"]} for item in summary.get("stations", [])] or _stations()
    return {"stations": cluster_stations(items), "source": "K-Means when supported by supplied predictions; ordered fallback otherwise"}


@app.post("/optimization/solve")
def optimization(request: OptimizationRequest) -> dict[str, Any]:
    ev_items = request.evs or _evs()
    station_items = request.stations or _stations()
    if not ev_items or not station_items:
        raise HTTPException(status_code=400, detail="At least one EV and one station are required.")
    try:
        problem = _optimization_problem(ev_items, station_items, request.traffic_level)
        quantum = solve_qaoa(problem)
        classical = solve_classically(problem)
        return {"qaoa_or_fallback": quantum, "classical_baseline": classical, "problem": {"ev_count": len(ev_items), "station_count": len(station_items), "time_slot_count": len(problem.get("time_slots", [])), "variable_count": len(problem.get("evs", [])) * len(problem.get("stations", [])) * len(problem.get("time_slots", []))}}
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/recommendation")
def recommendation(request: RecommendationRequest) -> dict[str, Any]:
    items = request.stations or _stations()
    return {"ev_id": request.ev.get("id"), "candidates": rank_stations(request.ev, items)}


@app.get("/analytics")
def analytics() -> dict[str, Any]:
    station_items = _stations()
    ev_items = _evs()
    info = diagnostics()
    model = predict_demand({})
    observed_wait = info.get("resolved_columns", {}).get("waiting_time")
    observed_load = info.get("resolved_columns", {}).get("station_load")
    waiting_values: list[float] = []
    load_values: list[float] = []
    if info["status"] == "loaded":
        from app.services.data_service import load_dataset
        frame, _ = load_dataset()
        if observed_wait:
            waiting_values = frame[observed_wait].dropna().astype(float).tolist()
        if observed_load:
            load_values = frame[observed_load].dropna().astype(float).tolist()
    return {"dataset": info, "metrics": {"rmse": model.get("metrics", {}).get("rmse"), "mae": model.get("metrics", {}).get("mae"), "mape": model.get("metrics", {}).get("mape"), "r2": model.get("metrics", {}).get("r2"), "average_waiting_minutes": round(sum(waiting_values) / len(waiting_values), 4) if waiting_values else None, "maximum_waiting_minutes": round(max(waiting_values), 4) if waiting_values else None, "average_eta_minutes": None, "peak_load": round(max(load_values), 4) if load_values else None, "peak_power_kw": max((item.get("available_power_kw", 0) for item in station_items), default=None), "station_utilization": None, "optimization_objective": None, "solver_execution_time_seconds": None}, "station_count": info.get("station_count", len(station_items)), "simulation_station_count": len(station_items), "ev_count": len(ev_items), "notice": "Metrics requiring unavailable observations are N/A - required data unavailable." if info["status"] != "loaded" else "Metrics shown are calculated from the supplied dataset where the required columns exist. Routing capacity remains limited to the explicit simulation catalog."}


@app.post("/simulation/run")
def simulation(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    ev = body.get("ev") or _evs()[0]
    station_items = _stations()
    candidates = rank_stations(ev, station_items)
    optimization_result = optimization(OptimizationRequest(evs=[ev], stations=station_items, traffic_level=body.get("traffic_level", "low")))
    return {"ev": ev, "candidates": candidates, "recommended_station": candidates[0] if candidates else None, "optimization": optimization_result}
