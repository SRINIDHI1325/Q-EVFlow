"""Station scoring and ranking."""

from __future__ import annotations

from typing import Any

from .simulation import calculate_eta


def rank_stations(ev: dict[str, Any], stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results = []
    for station in stations:
        try:
            eta = calculate_eta({"current_node": ev.get("current_node", "origin-a"), "station_id": station["id"], "required_energy_kwh": ev.get("required_energy_kwh", 24), "traffic_level": ev.get("traffic_level", "low")})
        except ValueError:
            continue
        score = eta["total_minutes"] + eta["distance_km"] * 2 + station.get("predicted_demand", 0) * 0.08 + station.get("queue_length", 0) * 3
        score -= min(station.get("available_power_kw", 0), 100) * 0.02
        results.append({"station_id": station["id"], "station": station["name"], "distance_km": eta["distance_km"], "eta_minutes": eta["travel_minutes"], "queue_length": station.get("queue_length", 0), "predicted_demand": station.get("predicted_demand"), "available_power_kw": station.get("available_power_kw", 0), "waiting_minutes": eta["waiting_minutes"], "charging_minutes": eta["charging_minutes"], "total_minutes": eta["total_minutes"], "recommendation_score": round(score, 3), "demand_tier": station.get("demand_tier", "Not evaluated")})
    return sorted(results, key=lambda item: item["recommendation_score"])
