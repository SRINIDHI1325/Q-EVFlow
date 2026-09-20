"""Feasibility checks for decoded assignment solutions."""

from collections import Counter
from typing import Any


def validate_assignments(problem: dict[str, Any], assignments: list[dict[str, str | None]]) -> dict[str, Any]:
	station_by_id = {station["id"]: station for station in problem.get("stations", [])}
	counts = Counter(item.get("station_id") for item in assignments if item.get("station_id"))
	violations = []
	ev_counts = Counter(item.get("ev_id") for item in assignments)
	for ev_id, count in ev_counts.items():
		if count != 1:
			violations.append(f"EV {ev_id} has {count} assignments")
	if problem.get("time_slots"):
		slot_counts = Counter((item.get("station_id"), item.get("time_slot_id")) for item in assignments if item.get("station_id") and item.get("time_slot_id"))
		for item in assignments:
			if not item.get("time_slot_id"):
				violations.append(f"EV {item.get('ev_id')} has no time slot")
		for (station_id, slot_id), count in slot_counts.items():
			station = station_by_id.get(station_id, {})
			if count > int(station.get("capacity", 0)):
				violations.append(f"Station {station_id} capacity exceeded in {slot_id}: {count}/{station.get('capacity', 0)}")
			power = sum(float(item.get("charging_power_kw", 0)) for item in assignments if item.get("station_id") == station_id and item.get("time_slot_id") == slot_id)
			station_power = float(station.get("available_power_kw", 0))
			if power > station_power:
				violations.append(f"Station {station_id} power exceeded in {slot_id}: {power:g}/{station_power:g} kW")
			grid_power = float(problem.get("grid_power_kw", float("inf")))
			if power > grid_power:
				violations.append(f"Grid power exceeded in {slot_id}: {power:g}/{grid_power:g} kW")
	for item in assignments:
		if not item.get("station_id"):
			violations.append(f"EV {item.get('ev_id')} is unassigned")
	for station_id, count in counts.items():
		station = station_by_id.get(station_id, {})
		capacity = int(station.get("capacity", 0))
		if count > capacity:
			violations.append(f"Station {station_id} capacity exceeded: {count}/{capacity}")
		requested_power = count * float(station.get("default_power_kw", 0))
		available_power = float(station.get("available_power_kw", 0))
		if requested_power > available_power:
			violations.append(f"Station {station_id} power exceeded: {requested_power:g}/{available_power:g} kW")
	return {"feasible": not violations, "violations": violations, "station_counts": dict(counts)}
