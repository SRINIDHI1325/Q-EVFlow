"""Local road graph and Dijkstra ETA calculations."""

from __future__ import annotations

import heapq
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SIM_DIR = ROOT.parent / "simulation"


def load_simulation() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    graph = json.loads((SIM_DIR / "road_graph.json").read_text(encoding="utf-8"))
    stations = json.loads((SIM_DIR / "stations.json").read_text(encoding="utf-8"))
    config = json.loads((SIM_DIR / "simulation_config.json").read_text(encoding="utf-8"))
    return graph, stations, config


def shortest_path(graph: dict[str, Any], start: str, target: str, traffic_multiplier: float = 1.0) -> dict[str, Any]:
    adjacency: dict[str, list[tuple[str, float, float]]] = {}
    for edge in graph.get("edges", []):
        distance = float(edge["distance_km"])
        minutes = float(edge["base_travel_minutes"]) * traffic_multiplier
        adjacency.setdefault(edge["from"], []).append((edge["to"], distance, minutes))
        adjacency.setdefault(edge["to"], []).append((edge["from"], distance, minutes))
    queue = [(0.0, 0.0, start, [start])]
    best: dict[str, float] = {start: 0.0}
    while queue:
        elapsed, distance_so_far, node, path = heapq.heappop(queue)
        if node == target:
            return {"path": path, "distance_km": round(distance_so_far, 3), "travel_minutes": round(elapsed, 2)}
        for neighbor, distance, minutes in adjacency.get(node, []):
            next_elapsed = elapsed + minutes
            if next_elapsed < best.get(neighbor, float("inf")):
                best[neighbor] = next_elapsed
                heapq.heappush(queue, (next_elapsed, distance_so_far + distance, neighbor, path + [neighbor]))
    raise ValueError(f"No route from {start} to {target}")


def calculate_eta(payload: dict[str, Any]) -> dict[str, Any]:
    graph, station_config, config = load_simulation()
    station = next((item for item in station_config["stations"] if item["id"] == payload.get("station_id")), None)
    if not station:
        raise ValueError(f"Unknown station: {payload.get('station_id')}")
    levels = config["traffic_multipliers"]
    traffic_level = payload.get("traffic_level", "low")
    multiplier = float(levels.get(traffic_level, 1.0))
    route = shortest_path(graph, payload.get("current_node", "origin-a"), station["node_id"], multiplier)
    queue_length = max(0, int(payload.get("queue_length", station.get("queue_length", 0))))
    waiting_minutes = queue_length * float(payload.get("minutes_per_vehicle", 10))
    required_energy = max(0.0, float(payload.get("required_energy_kwh", 24)))
    power = max(0.1, float(payload.get("charging_power_kw", station.get("default_power_kw", 11))))
    charging_minutes = required_energy / power * 60
    total = route["travel_minutes"] + waiting_minutes + charging_minutes
    arrival = datetime.now(timezone.utc) + timedelta(minutes=route["travel_minutes"])
    return {**route, "station_id": station["id"], "traffic_level": traffic_level, "traffic_multiplier": multiplier, "arrival_time": arrival.isoformat(), "waiting_minutes": round(waiting_minutes, 2), "charging_minutes": round(charging_minutes, 2), "total_minutes": round(total, 2), "provenance": "local simulated road graph"}
