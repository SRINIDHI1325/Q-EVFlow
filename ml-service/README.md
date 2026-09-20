# ML service

The FastAPI service will inspect `data/dataset.csv` at startup or request time, resolve aliases from `data/column_mapping.json`, and report unavailable fields explicitly. The dataset was not present during Phase 1 scaffold creation, so model metrics are not evaluated yet.

Planned responsibilities:

- preprocessing and data diagnostics
- time-aware Random Forest demand prediction
- demand-tier clustering
- local ETA and route integration
- optimization orchestration
