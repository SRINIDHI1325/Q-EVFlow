# Optimization module

This module contains two compatible formulations:

- Assignment-only `x[i,j]` variables for callers that do not provide `time_slots`.
- Time-slot-aware `x[i,j,t]` variables when configured slots are present. Each EV receives one station/slot, while station capacity, station power, and grid power are validated per slot. Route, ETA, waiting, demand, congestion, charging-power, and peak-load terms contribute to the linear cost; invalid slot choices receive penalties.

The local QAOA path is bounded by `simulation/simulation_config.json`. Results include the decoded station, time slot, charging power, ETA, waiting time, feasibility, objective value, bitstring, and measured runtime. Larger or failed problems retain the classical fallback.
