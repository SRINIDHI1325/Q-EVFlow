"""Exhaustive classical baseline for bounded assignment instances."""

from __future__ import annotations

from itertools import product
from time import perf_counter
from typing import Any

from .constraints import validate_assignments
from .qubo import build_qubo, decode_assignment, evaluate_bitstring


def solve_classically(problem: dict[str, Any]) -> dict[str, Any]:
	started = perf_counter()
	qubo = build_qubo(problem)
	best: tuple[float, str] | None = None
	if problem.get("time_slots"):
		candidate_bits = []
		options_by_ev = [[(ev["id"], station["id"], slot["id"]) for station in problem.get("stations", []) for slot in problem.get("time_slots", [])] for ev in problem.get("evs", [])]
		for selected in product(*options_by_ev):
			selected_by_ev = {item[0]: item for item in selected}
			bits = ["0"] * len(qubo["variables"])
			for index, variable in enumerate(qubo["variables"]):
				_, ev_id, station_id, slot_id = variable.split("_", 3)
				if selected_by_ev.get(ev_id) == (ev_id, station_id, slot_id):
					bits[index] = "1"
			candidate_bits.append("".join(bits))
	else:
		candidate_bits = ("".join(bits) for bits in product("01", repeat=len(qubo["variables"])))
	for bitstring in candidate_bits:
		score = evaluate_bitstring(qubo, bitstring)
		assignments = decode_assignment(qubo, bitstring)
		validation = validate_assignments(problem, assignments)
		if validation["feasible"] and (best is None or score < best[0]):
			best = (score, bitstring)
	if best is None:
		best = (0.0, "0" * len(qubo["variables"]))
	assignments = decode_assignment(qubo, best[1])
	return _result(problem, assignments, best[0], best[1], perf_counter() - started, "classical")


def _result(problem: dict[str, Any], assignments: list[dict[str, str | None]], objective: float, bitstring: str, elapsed: float, solver: str) -> dict[str, Any]:
	validation = validate_assignments(problem, assignments)
	station_by_id = {station["id"]: station for station in problem.get("stations", [])}
	power = []
	for station_id, count in validation["station_counts"].items():
		station = station_by_id[station_id]
		power.append({"station_id": station_id, "power_kw": round(min(float(station.get("available_power_kw", 0)), count * float(station.get("default_power_kw", 7.2))), 2)})
	if problem.get("time_slots"):
		power = [{"station_id": station_id, "time_slot_id": slot_id, "power_kw": round(sum(float(item.get("charging_power_kw", 0)) for item in assignments if item.get("station_id") == station_id and item.get("time_slot_id") == slot_id), 2)} for station_id, slot_id in sorted({(item.get("station_id"), item.get("time_slot_id")) for item in assignments if item.get("station_id") and item.get("time_slot_id")})]
	return {"solver": solver, "assignments": assignments, "power_allocation": power, "objective_value": round(objective, 4), "feasible": validation["feasible"], "violations": validation["violations"], "bitstring": bitstring, "execution_time_seconds": round(elapsed, 6)}
