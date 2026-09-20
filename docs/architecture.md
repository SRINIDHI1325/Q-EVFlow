# Q-EVFlow architecture

## Boundaries

The React frontend owns presentation and user interaction. The Node/Express backend is the REST gateway and orchestration boundary. The FastAPI service owns data-dependent Python workloads: preprocessing, Random Forest demand prediction, K-Means clustering, route/ETA calculations, and optimization orchestration. The `optimization/` package owns QUBO construction and solver implementations and must return auditable metadata such as feasibility, objective value, bitstring, solver type, and execution time.

## Request flow

```text
React dashboard
    |
    v
Node/Express REST gateway
    |
    v
FastAPI ML/optimization service
    |                 \
    v                  v
CSV/config inputs    QUBO + local QAOA/classical solver
    |
    v
Structured response with diagnostics and provenance
```

## Data rules

The application must inspect actual CSV headers before selecting features or targets. Aliases are configured in `ml-service/data/column_mapping.json`. Missing fields are either derived from valid source data or returned as unavailable/configurable; they are never silently filled with fabricated measurements. Metrics are reported as `N/A` or `Not evaluated yet` when the required observations do not exist.

## Local execution constraints

The road graph, station catalog, and traffic multipliers are local JSON inputs. Route calculation uses Dijkstra. QAOA uses a local simulator and is bounded by the configured variable limit; larger or failed workloads use the classical fallback. No cloud quantum credentials or live external APIs are required.
