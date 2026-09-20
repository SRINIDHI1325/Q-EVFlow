# Q-EVFlow

AI-Driven Dynamic EV Charging Optimization Using Quantum Computing and Intelligent ETA Prediction.

## Current implementation

The local application is implemented end to end. It includes preprocessing diagnostics, optional Random Forest demand prediction, K-Means demand tiers, Dijkstra ETA, station recommendation, bounded QUBO assignment, optional QAOA, classical fallback, an Express gateway, and a React dashboard. The workspace did not contain a supplied CSV dataset, so dataset-dependent metrics remain `N/A` and no real-world statistics are claimed.

The application is designed for a normal laptop and will use a local quantum simulator only. It does not require physical EV hardware, cloud quantum credentials, paid APIs, GPUs, or live traffic services for the core workflow. The optional Nearby Real Stations feature uses the free Open Charge Map public API through Express when internet access is available.

## Architecture

- `frontend/`: React/Vite dashboard.
- `backend/`: Node/Express API gateway and orchestration layer.
- `ml-service/`: FastAPI service for preprocessing, demand prediction, clustering, ETA, and optimization calls.
- `optimization/`: QUBO formulation, local QAOA solver, and classical fallback.
- `simulation/`: deterministic road/station/configuration inputs for local route simulation.
- `docs/`: architecture and methodology documentation.

The intended request flow is `React -> Express -> FastAPI -> ML/optimization -> Express -> React`.

## Dataset setup

Copy the provided public dataset to `ml-service/data/dataset.csv`. Do not label it as real-world or report metrics until its provenance and actual columns have been inspected. Column aliases and required-field behavior are defined in `ml-service/data/column_mapping.json`.

## Run locally

Use three terminals from the repository root. Python 3.11+ and Node.js 18+ are recommended.

```bash
# Terminal 1: Python service
cd ml-service
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2: Express gateway
cd backend
npm install
npm run dev

# Terminal 3: React dashboard
cd frontend
npm install
npm run dev
```

Open the Vite URL printed by the frontend, usually `http://localhost:5173`.

For live nearby stations, optionally configure the backend before starting Express:

```bash
cd backend
cp .env.example .env
# Set OCM_API_KEY in backend/.env if you have an Open Charge Map key.
```

The browser must be running on `localhost` or another secure origin to grant geolocation permission. Click **Nearby Real Stations**, allow location access, and choose a search radius. The browser location is held in React memory for the current search and is not persisted.

The dashboard works with the explicit local simulation catalog even when `ml-service/data/dataset.csv` is absent. To enable demand-model evaluation, place the supplied CSV at that path and restart the Python service. Actual columns are resolved through `ml-service/data/column_mapping.json`.

## Nearby Real Stations

The **Nearby Real Stations** page requests browser location permission and calls `GET /api/nearby-stations` through the Express backend. The backend queries Open Charge Map, calculates Haversine distance, sorts results, and returns station names, coordinates, addresses, connectors, power, and status only when the provider supplies them. No location is stored permanently.

Copy `backend/.env.example` to `backend/.env` when configuring the backend. The exact variable is `OCM_API_KEY`. Open Charge Map supports limited public requests without a key, so the feature can attempt unauthenticated access; adding a personal key is recommended for higher limits. Never put the key in Vite or React environment variables. If location permission, internet access, the provider, or rate limits fail, the page shows: `Live nearby station data unavailable. Showing Q-EVFlow simulation data.`

Real API fields are labeled **Real API Data**. ETA is a Q-EVFlow planning estimate using distance and a 30 km/h planning speed. Queue length, demand, congestion, and waiting time are displayed as unavailable unless the provider supplies them; the existing simulation remains the fallback.

Manual checks:

```bash
# API validation and live-provider path
curl "http://127.0.0.1:3000/api/nearby-stations?latitude=37.7749&longitude=-122.4194&distance=10"

# Invalid coordinates should return 400
curl -i "http://127.0.0.1:3000/api/nearby-stations?latitude=999&longitude=0&distance=10"

# Existing simulation must still respond
curl -X POST "http://127.0.0.1:3000/api/simulation/run" -H "Content-Type: application/json" -d "{\"ev\":{\"id\":\"EV-TEST\",\"current_node\":\"origin-a\",\"required_energy_kwh\":24}}"
```

Expected fallback message: **Live nearby station data unavailable. Showing Q-EVFlow simulation data.** This is used for denied permission, unavailable location, provider failure, missing key, empty responses, and rate limits. The fallback does not claim live station availability.

Optimization uses the configured time slots in `simulation/simulation_config.json`. The default local demonstration has three slots and produces `x[i,j,t]` variables. The local QAOA limit is set to 18 variables so a small 2-EV/2-station/3-slot case runs on a laptop; larger cases use the explicit classical fallback. Increase the limit only after measuring runtime. The optimization response includes per-EV station, time slot, power, ETA, waiting time, feasibility, objective, and solver runtime.

## API

The Express gateway exposes `GET /api/health`, `/api/stations`, `/api/evs`, `POST /api/eta`, `POST /api/ml/predict-demand`, `GET /api/ml/metrics`, `POST /api/ml/cluster-stations`, `POST /api/optimization/solve`, `POST /api/recommendation`, `GET /api/analytics`, and `POST /api/simulation/run`. The Python service provides the same paths without the `/api` prefix on port 8000.

## Research boundary

Q-EVFlow combines Random Forest demand prediction, K-Means station grouping, Dijkstra route calculation, QUBO modeling, QAOA on a local simulator, and a classical fallback. It is not a reproduction of any particular paper and will not claim quantum speedup or performance improvement without executed experiments.

## Limitations and future work

The current route graph and station records are configurable simulation inputs, not live infrastructure. The QAOA path is intentionally bounded for laptop execution and falls back when Qiskit Algorithms is unavailable or the variable limit is exceeded. A supplied dataset is required for actual model metrics. Future work can add richer time-slot power variables, calibrated weather/traffic features, persistence, and experiments comparing solver quality under controlled workloads.
