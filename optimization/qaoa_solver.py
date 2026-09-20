"""Optional local QAOA solver with an explicit classical fallback."""

from __future__ import annotations

from typing import Any
from time import perf_counter

from .classical_solver import solve_classically


def solve_qaoa(problem: dict[str, Any], max_variables: int = 12) -> dict[str, Any]:
	max_variables = int(problem.get("max_quantum_variables", max_variables))
	variable_count = len(problem.get("evs", [])) * len(problem.get("stations", [])) * max(1, len(problem.get("time_slots", [])))
	if variable_count > max_variables:
		result = solve_classically(problem)
		result["solver"] = "classical_fallback"
		result["fallback_reason"] = f"Problem has {variable_count} variables; local QAOA limit is {max_variables}."
		return result
	try:
		from qiskit_algorithms import QAOA
		from qiskit_algorithms.optimizers import COBYLA
		from qiskit import transpile
		from qiskit_aer import AerSimulator
		from qiskit_aer.primitives import SamplerV2
		from qiskit_optimization.algorithms import MinimumEigenOptimizer
		from qiskit_optimization import QuadraticProgram
		from .qubo import build_qubo, evaluate_bitstring

		qubo = build_qubo(problem)
		program = QuadraticProgram()
		for variable in qubo["variables"]:
			program.binary_var(variable)
		program.minimize(linear=qubo["linear"], quadratic={tuple(key.split("|")): value for key, value in qubo["quadratic"].items()})
		class AerTranspiler:
			def __init__(self) -> None:
				self.backend = AerSimulator()

			def run(self, circuits: Any, **options: Any) -> Any:
				return transpile(circuits, backend=self.backend, **options)

		started = perf_counter()
		qaoa = QAOA(sampler=SamplerV2(seed=42), optimizer=COBYLA(maxiter=30), reps=1, transpiler=AerTranspiler())
		result = MinimumEigenOptimizer(qaoa).solve(program)
		elapsed = perf_counter() - started
		bits = "".join(str(int(result.x[index])) for index in range(len(qubo["variables"])))
		from .classical_solver import _result
		decoded = __import__("optimization.qubo", fromlist=["decode_assignment"]).decode_assignment(qubo, bits)
		objective = evaluate_bitstring(qubo, bits)
		return _result(problem, decoded, objective, bits, elapsed, "qaoa_local_simulator") | {"solver_label": "QAOA - Local Simulator", "qiskit_objective_value": float(result.fval)}
	except Exception as error:
		result = solve_classically(problem)
		result["solver"] = "classical_fallback"
		result["fallback_reason"] = f"Local QAOA unavailable or failed: {error}"
		return result
