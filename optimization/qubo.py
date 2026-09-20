"""Bounded EV-to-station assignment QUBO construction."""

from __future__ import annotations

from itertools import product
from typing import Any


def build_assignment_qubo(problem: dict[str, Any]) -> dict[str, Any]:
	"""Build a binary assignment QUBO and retain enough metadata to decode it.

	The binary variables are x[ev, station]. One-hot assignment and station
	capacity are represented as penalty terms. Power allocation is computed
	after decoding because it is continuous in this laptop-sized model.
	"""
	evs = problem.get("evs", [])
	stations = problem.get("stations", [])
	weights = problem.get("weights", {})
	assignment_penalty = float(weights.get("assignment_penalty", 100.0))
	capacity_penalty = float(weights.get("capacity_penalty", 100.0))
	variables = [f"x_{ev['id']}_{station['id']}" for ev in evs for station in stations]
	linear: dict[str, float] = {}
	quadratic: dict[str, float] = {}

	def add_quadratic(left: str, right: str, value: float) -> None:
		key = "|".join(sorted((left, right)))
		quadratic[key] = quadratic.get(key, 0.0) + value

	for ev in evs:
		choices = [f"x_{ev['id']}_{station['id']}" for station in stations]
		for variable in choices:
			linear[variable] = linear.get(variable, 0.0) - assignment_penalty
		for left, right in product(choices, choices):
			if left < right:
				add_quadratic(left, right, 2 * assignment_penalty)

		for station in stations:
			variable = f"x_{ev['id']}_{station['id']}"
			route = next((item for item in problem.get("routes", []) if item["ev_id"] == ev["id"] and item["station_id"] == station["id"]), {})
			cost = (
				float(route.get("distance_km", 0.0)) * float(weights.get("distance", 1.0))
				+ float(route.get("travel_minutes", 0.0)) * float(weights.get("eta", 1.0))
				+ float(route.get("waiting_minutes", 0.0)) * float(weights.get("waiting", 1.0))
				+ float(station.get("predicted_demand", 0.0)) * float(weights.get("demand", 0.1))
			)
			linear[variable] = linear.get(variable, 0.0) + cost

	for station in stations:
		station_choices = [f"x_{ev['id']}_{station['id']}" for ev in evs]
		capacity = int(station.get("capacity", len(evs)))
		power_per_vehicle = float(station.get("default_power_kw", 0))
		power_limit = int(float(station.get("available_power_kw", 0)) // power_per_vehicle) if power_per_vehicle > 0 else len(evs)
		allowed_assignments = max(0, min(capacity, power_limit))
		overflow_penalty = capacity_penalty / max(allowed_assignments, 1)
		for left, right in product(station_choices, station_choices):
			if left < right:
				add_quadratic(left, right, 2 * overflow_penalty)

	return {
		"variables": variables,
		"linear": linear,
		"quadratic": quadratic,
		"constant": assignment_penalty * len(evs),
		"problem": problem,
	}


def build_time_slot_qubo(problem: dict[str, Any]) -> dict[str, Any]:
	"""Build x[ev, station, time_slot] assignment QUBO.

	Each EV receives exactly one station/slot. Pair penalties enforce station
	capacity and grid-power limits within each slot. Invalid EV-slot choices
	receive a large linear penalty rather than being silently discarded.
	"""
	evs = problem.get("evs", [])
	stations = problem.get("stations", [])
	slots = problem.get("time_slots", [])
	weights = problem.get("weights", {})
	assignment_penalty = float(weights.get("assignment_penalty", 1000.0))
	capacity_penalty = float(weights.get("capacity_penalty", 1000.0))
	invalid_penalty = float(weights.get("invalid_penalty", 2000.0))
	variables = [f"x_{ev['id']}_{station['id']}_{slot['id']}" for ev in evs for station in stations for slot in slots]
	linear: dict[str, float] = {}
	quadratic: dict[str, float] = {}

	def add_quadratic(left: str, right: str, value: float) -> None:
		key = "|".join(sorted((left, right)))
		quadratic[key] = quadratic.get(key, 0.0) + value

	routes = {(item["ev_id"], item["station_id"]): item for item in problem.get("routes", [])}
	for ev in evs:
		choices = [f"x_{ev['id']}_{station['id']}_{slot['id']}" for station in stations for slot in slots]
		for variable in choices:
			linear[variable] = -assignment_penalty
		for left, right in product(choices, choices):
			if left < right:
				add_quadratic(left, right, 2 * assignment_penalty)
		for station in stations:
			route = routes.get((ev["id"], station["id"]), {})
			for slot_index, slot in enumerate(slots):
				variable = f"x_{ev['id']}_{station['id']}_{slot['id']}"
				power = float(ev.get("charging_power_kw", station.get("default_power_kw", 0)))
				cost = (
					float(route.get("distance_km", 0)) * float(weights.get("distance", 1))
					+ float(route.get("travel_minutes", 0)) * float(weights.get("eta", 1))
					+ (float(route.get("waiting_minutes", 0)) + slot_index * float(problem.get("slot_duration_minutes", 30))) * float(weights.get("waiting", 1))
					+ float(station.get("predicted_demand", 0)) * float(weights.get("demand", 0.1))
					+ float(station.get("queue_length", 0)) * float(weights.get("congestion", 0.5))
					+ power * float(weights.get("charging_power", 0.05))
					+ (power / max(float(problem.get("grid_power_kw", 1)), 1)) * float(weights.get("peak_load", 1))
				)
				allowed_slots = ev.get("allowed_time_slots")
				if allowed_slots is not None and slot["id"] not in allowed_slots:
					cost += invalid_penalty
				linear[variable] += cost

	for station in stations:
		for slot in slots:
			choices = [f"x_{ev['id']}_{station['id']}_{slot['id']}" for ev in evs]
			for left, right in product(choices, choices):
				if left < right:
					left_ev = next(ev for ev in evs if left.startswith(f"x_{ev['id']}_"))
					right_ev = next(ev for ev in evs if right.startswith(f"x_{ev['id']}_"))
					left_power = float(left_ev.get("charging_power_kw", station.get("default_power_kw", 0)))
					right_power = float(right_ev.get("charging_power_kw", station.get("default_power_kw", 0)))
					capacity_limit = int(station.get("capacity", len(evs)))
					grid_limit = float(problem.get("grid_power_kw", float("inf")))
					pair_penalty = capacity_penalty / max(capacity_limit, 1)
					if left_power + right_power > min(float(station.get("available_power_kw", grid_limit)), grid_limit):
						pair_penalty += capacity_penalty
					add_quadratic(left, right, 2 * pair_penalty)

	return {"variables": variables, "linear": linear, "quadratic": quadratic, "constant": assignment_penalty * len(evs), "problem": problem, "model": "time_slot"}


def build_qubo(problem: dict[str, Any]) -> dict[str, Any]:
	return build_time_slot_qubo(problem) if problem.get("time_slots") else build_assignment_qubo(problem)


def evaluate_bitstring(qubo: dict[str, Any], bitstring: str) -> float:
	values = dict(zip(qubo["variables"], (int(bit) for bit in bitstring)))
	score = float(qubo.get("constant", 0.0))
	score += sum(value * values.get(variable, 0) for variable, value in qubo["linear"].items())
	for key, value in qubo["quadratic"].items():
		left, right = key.split("|")
		score += value * values.get(left, 0) * values.get(right, 0)
	return score


def decode_assignment(qubo: dict[str, Any], bitstring: str) -> list[dict[str, Any]]:
	problem = qubo["problem"]
	values = dict(zip(qubo["variables"], (int(bit) for bit in bitstring)))
	assignments = []
	if qubo.get("model") == "time_slot":
		routes = {(item["ev_id"], item["station_id"]): item for item in problem.get("routes", [])}
		for ev in problem.get("evs", []):
			selected = next(((station["id"], slot) for station in problem.get("stations", []) for slot in problem.get("time_slots", []) if values.get(f"x_{ev['id']}_{station['id']}_{slot['id']}") == 1), (None, None))
			station_id, slot = selected
			route = routes.get((ev["id"], station_id), {})
			assignments.append({"ev_id": ev["id"], "station_id": station_id, "time_slot": slot.get("label") if slot else None, "time_slot_id": slot.get("id") if slot else None, "charging_power_kw": float(ev.get("charging_power_kw", next((station.get("default_power_kw", 0) for station in problem.get("stations", []) if station["id"] == station_id), 0))), "eta_minutes": route.get("travel_minutes"), "waiting_minutes": route.get("waiting_minutes")})
		return assignments
	for ev in problem.get("evs", []):
		selected = next((station["id"] for station in problem.get("stations", []) if values.get(f"x_{ev['id']}_{station['id']}") == 1), None)
		assignments.append({"ev_id": ev["id"], "station_id": selected})
	return assignments
