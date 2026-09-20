# Methodology outline

1. Inspect and preprocess the supplied CSV using configurable column aliases.
2. Build time-aware features and train a Random Forest regressor only when a valid target and sufficient observations exist.
3. Predict station demand and rank K-Means centroids into low, moderate, and high demand tiers.
4. Calculate local route distance and travel time with Dijkstra over the simulated graph.
5. Estimate waiting and charging time from observed or explicitly configurable inputs.
6. Build a bounded assignment and power-allocation QUBO. With configured time slots, binary `x[i,j,t]` equals 1 when EV `i` uses station `j` in slot `t`; one-hot assignment, station-slot capacity, station power, grid power, and invalid-slot constraints become penalty terms.
7. Solve with QAOA on a local simulator when within the configured size limit; otherwise use a classical baseline.
8. Validate and expose assignments, objective values, feasibility, and execution diagnostics without making unexecuted scientific claims.

For the time-slot objective, the linear cost for `x[i,j,t]` combines available route distance, ETA, waiting time including the slot offset, predicted demand, station congestion, charging power, and a peak-load contribution. Penalties are added for missing/duplicate EV assignments, slot capacity overflow, station power overflow, grid power overflow, and invalid EV-slot choices. The configured demonstration uses `06:00-06:30`, `06:30-07:00`, and `07:00-07:30`; these are configuration values, not permanent assumptions.
