# API outline

The Node gateway will expose:

- `GET /api/health`
- `GET /api/stations`
- `GET /api/stations/:id`
- `GET /api/evs`
- `POST /api/eta`
- `POST /api/ml/predict-demand`
- `GET /api/ml/metrics`
- `POST /api/ml/cluster-stations`
- `POST /api/optimization/solve`
- `POST /api/recommendation`
- `GET /api/analytics`
- `POST /api/simulation/run`
- `GET /api/nearby-stations?latitude=&longitude=&distance=`

FastAPI will provide the Python implementation behind the ML, ETA, and optimization routes. Request validation will reject invalid SOC, capacity, power, distance, queue, station, and EV values with actionable errors.

Optimization responses preserve `ev_id`, `station_id`, and existing solver metadata. When time slots are configured, each decoded assignment also includes `time_slot`, `time_slot_id`, `charging_power_kw`, `eta_minutes`, and `waiting_minutes`; `power_allocation` is reported per station and slot.

The nearby-stations route proxies Open Charge Map and may use OpenStreetMap Overpass when OCM rejects a request without a key. It returns `real_api_data` and `qevflow_estimates` separately. Provider outages or rate limits are returned as an API error for the React fallback layer to handle.
