import { useEffect, useState } from "react";
import { getDashboardData, getHealth, runSimulation } from "./services/api.js";
import NearbyStations from "./pages/NearbyStations.jsx";

const navItems = [
  "Dashboard",
  "EV Simulation",
  "Charging Stations",
  "Nearby Real Stations",
  "Demand Prediction",
  "Optimization",
  "ETA / Route",
  "Analytics",
  "About Q-EVFlow",
];

function tierClass(tier = "") {
  if (tier.includes("High")) return "high";
  if (tier.includes("Moderate")) return "moderate";
  return "low";
}

function StatCard({ label, value, note }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}

function DemandChart({ stations }) {
  const max = Math.max(
    ...stations.map((station) => station.predicted_demand || 0),
    1,
  );
  return (
    <div className="chart">
      {stations.map((station) => (
        <div className="bar-wrap" key={station.id}>
          <div
            className="bar"
            style={{
              height: `${Math.max(5, (station.predicted_demand / max) * 150)}px`,
            }}
            title={`${station.predicted_demand} configured demand units`}
          />
          <span className="bar-label">{station.id.replace("S-", "")}</span>
        </div>
      ))}
    </div>
  );
}

function StationTable({ stations }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Station</th>
            <th>Demand</th>
            <th>Tier</th>
            <th>Queue</th>
            <th>Power</th>
            <th>Capacity</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((station) => (
            <tr key={station.id}>
              <td>
                <strong>{station.name}</strong>
                <br />
                <span className="muted">{station.id}</span>
              </td>
              <td>{station.predicted_demand}</td>
              <td>
                <span className={`badge ${tierClass(station.demand_tier)}`}>
                  {station.demand_tier}
                </span>
              </td>
              <td>{station.queue_length}</td>
              <td>{station.available_power_kw} kW</td>
              <td>{station.capacity} EVs</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ data, setPage }) {
  const stations = data?.stations?.stations || [];
  const datasetStations = data?.stations?.dataset_station_clusters || [];
  const highDemand = stations.filter((station) =>
    station.demand_tier.includes("High"),
  ).length;
  const analytics = data?.analytics || {};
  const metrics = analytics.metrics || {};
  const records = analytics.dataset?.rows || 0;
  return (
    <>
      <div className="grid kpi-grid">
        <StatCard
          label="Dataset records"
          value={records || "N/A"}
          note={
            records
              ? "Loaded from dataset.csv"
              : "N/A - required data unavailable"
          }
        />
        <StatCard
          label="Active stations"
          value={data?.analytics?.station_count || "N/A"}
          note={
            records ? "Dataset + local station map" : "Local simulation catalog"
          }
        />
        <StatCard
          label="Predicted demand"
          value={
            datasetStations.length
              ? datasetStations
                  .reduce(
                    (total, station) => total + (station.predicted_demand || 0),
                    0,
                  )
                  .toFixed(1)
              : "N/A"
          }
          note={
            records
              ? "Dataset-derived when mapped"
              : "N/A - required data unavailable"
          }
        />
        <StatCard
          label="Peak load"
          value={metrics.peak_load ?? "N/A"}
          note={
            metrics.peak_load == null
              ? "N/A - required data unavailable"
              : "Dataset-derived station load"
          }
        />
      </div>
      <div className="grid two-col" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Station demand profile</h2>
              <span className="muted">
                {records
                  ? `${datasetStations.length} observed stations clustered from Random Forest predictions`
                  : "Configured local simulation values"}
              </span>
            </div>
            <button
              className="secondary"
              onClick={() => setPage("Charging Stations")}
            >
              Inspect stations
            </button>
          </div>
          <DemandChart stations={stations} />
        </section>
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Research status</h2>
              <span className="muted">Evidence-aware project state</span>
            </div>
          </div>
          <div className="callout">{analytics.notice}</div>
          <p className="muted" style={{ marginTop: 18 }}>
            The route graph and station catalog remain explicit local simulation
            inputs, separate from dataset-derived measurements.
          </p>
          <button className="primary" onClick={() => setPage("EV Simulation")}>
            Run a simulation
          </button>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-head">
          <div>
            <h2>Charging stations</h2>
            <span className="muted">Operational snapshot</span>
          </div>
        </div>
        <StationTable stations={stations} />
      </section>
    </>
  );
}

function Simulation({ evs, stations, onResult }) {
  const initial = evs[0] || {
    id: "EV-001",
    current_node: "origin-a",
    battery_capacity_kwh: 60,
    soc: 35,
    required_energy_kwh: 32,
    priority: "normal",
  };
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: ["battery_capacity_kwh", "soc", "required_energy_kwh"].includes(
        key,
      )
        ? Number(value)
        : value,
    }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const output = await runSimulation({ ev: form });
      setResult(output);
      onResult(output);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          "Start the local backend and ML service to run this workflow.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid two-col">
      <section className="card">
        <div className="section-head">
          <div>
            <h2>EV simulation</h2>
            <span className="muted">
              Route, demand, recommendation, and assignment
            </span>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>EV ID</label>
              <input
                value={form.id}
                onChange={(event) => update("id", event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Current location</label>
              <select
                value={form.current_node}
                onChange={(event) => update("current_node", event.target.value)}
              >
                <option value="origin-a">Origin A</option>
                <option value="origin-b">Origin B</option>
              </select>
            </div>
            <div className="field">
              <label>Battery capacity (kWh)</label>
              <input
                type="number"
                min="1"
                value={form.battery_capacity_kwh}
                onChange={(event) =>
                  update("battery_capacity_kwh", event.target.value)
                }
                required
              />
            </div>
            <div className="field">
              <label>Current SOC (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={form.soc}
                onChange={(event) => update("soc", event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Required energy (kWh)</label>
              <input
                type="number"
                min="0"
                value={form.required_energy_kwh}
                onChange={(event) =>
                  update("required_energy_kwh", event.target.value)
                }
                required
              />
            </div>
            <div className="field">
              <label>Priority</label>
              <select
                value={form.priority}
                onChange={(event) => update("priority", event.target.value)}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Calculating..." : "Run Q-EVFlow"}
            </button>
          </div>
        </form>
        {error && (
          <div className="error" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}
      </section>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Workflow stages</h2>
            <span className="muted">One request, inspectable outputs</span>
          </div>
        </div>
        <div className="callout">
          1. Dijkstra route
          <br />
          2. ETA and queue estimate
          <br />
          3. Station demand tier
          <br />
          4. QUBO assignment
          <br />
          5. QAOA or classical fallback
        </div>
        {result?.recommended_station && (
          <div style={{ marginTop: 18 }}>
            <span className="eyebrow">Recommended station</span>
            <h2 style={{ marginTop: 6 }}>
              {result.recommended_station.station}
            </h2>
            <p className="muted">
              Score {result.recommended_station.recommendation_score} ·{" "}
              {result.recommended_station.total_minutes} minutes total
            </p>
          </div>
        )}
      </section>
      {result && (
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="section-head">
            <div>
              <h2>Simulation result</h2>
              <span className="muted">
                Ranked candidates and solver evidence
              </span>
            </div>
            <span
              className={`badge ${result.optimization.qaoa_or_fallback.feasible ? "low" : "high"}`}
            >
              {result.optimization.qaoa_or_fallback.solver ===
              "qaoa_local_simulator"
                ? "QAOA - Local Simulator"
                : result.optimization.qaoa_or_fallback.solver}
            </span>
          </div>
          <div className="grid result-grid">
            {result.candidates.slice(0, 3).map((candidate) => (
              <div className="card" key={candidate.station_id}>
                <h3>{candidate.station}</h3>
                <div className="result-value">
                  {candidate.total_minutes} min
                </div>
                <p className="muted">
                  {candidate.distance_km} km · queue {candidate.queue_length} ·{" "}
                  {candidate.available_power_kw} kW
                </p>
                <span className={`badge ${tierClass(candidate.demand_tier)}`}>
                  {candidate.demand_tier}
                </span>
              </div>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>EV</th>
                  <th>Station</th>
                  <th>Time slot</th>
                  <th>Power</th>
                  <th>ETA</th>
                  <th>Waiting time</th>
                  <th>Feasibility</th>
                </tr>
              </thead>
              <tbody>
                {result.optimization.qaoa_or_fallback.assignments.map(
                  (assignment) => (
                    <tr key={assignment.ev_id}>
                      <td>{assignment.ev_id}</td>
                      <td>{assignment.station_id}</td>
                      <td>{assignment.time_slot || "N/A"}</td>
                      <td>{assignment.charging_power_kw} kW</td>
                      <td>{assignment.eta_minutes ?? "N/A"} min</td>
                      <td>{assignment.waiting_minutes ?? "N/A"} min</td>
                      <td>
                        {result.optimization.qaoa_or_fallback.feasible
                          ? "Feasible"
                          : "Infeasible"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Allocated power</th>
                </tr>
              </thead>
              <tbody>
                {result.optimization.qaoa_or_fallback.power_allocation.map(
                  (allocation) => (
                    <tr key={allocation.station_id}>
                      <td>{allocation.station_id}</td>
                      <td>{allocation.power_kw} kW</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 10 }}>Station usage timeline</h3>
            <table>
              <thead>
                <tr>
                  <th>Time slot</th>
                  <th>Station</th>
                  <th>EVs</th>
                  <th>Power</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...new Set(
                    result.optimization.qaoa_or_fallback.assignments.map(
                      (item) => item.time_slot_id,
                    ),
                  ),
                ].map((slotId) =>
                  result.optimization.qaoa_or_fallback.assignments
                    .filter((item) => item.time_slot_id === slotId)
                    .map((item) => (
                      <tr key={`${slotId}-${item.ev_id}`}>
                        <td>{item.time_slot}</td>
                        <td>{item.station_id}</td>
                        <td>{item.ev_id}</td>
                        <td>{item.charging_power_kw} kW</td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Analytics({ data }) {
  const metrics = data?.metrics?.model || {};
  const system = data?.analytics?.metrics || {};
  const stationClusters = data?.stations?.dataset_station_clusters || [];
  return (
    <div className="grid two-col">
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Model evaluation</h2>
            <span className="muted">
              Calculated only from supplied observations
            </span>
          </div>
        </div>
        <div className="grid result-grid">
          {[
            ["RMSE", metrics.rmse],
            ["MAE", metrics.mae],
            ["MAPE", metrics.mape],
            ["R²", metrics.r2],
          ].map(([label, value]) => (
            <div className="card" key={label}>
              <div className="kpi-label">{label}</div>
              <div className="result-value">{value ?? "N/A"}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-head">
          <div>
            <h2>Dataset station clustering</h2>
            <span className="muted">
              K-Means labels ordered by Random Forest predicted energy demand
            </span>
          </div>
        </div>
        {stationClusters.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Station ID</th>
                  <th>Predicted demand</th>
                  <th>Cluster</th>
                  <th>Demand tier</th>
                </tr>
              </thead>
              <tbody>
                {stationClusters
                  .slice()
                  .sort(
                    (left, right) =>
                      right.predicted_demand - left.predicted_demand,
                  )
                  .slice(0, 20)
                  .map((station) => (
                    <tr key={station.id}>
                      <td>{station.id}</td>
                      <td>{station.predicted_demand}</td>
                      <td>{station.cluster ?? "N/A"}</td>
                      <td>
                        <span
                          className={`badge ${tierClass(station.demand_tier)}`}
                        >
                          {station.demand_tier}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            N/A - station clustering requires a supported target and station
            IDs.
          </p>
        )}
      </section>
      <section className="card">
        <h2>Operational analytics</h2>
        <div className="grid result-grid" style={{ marginTop: 18 }}>
          {[
            ["Records", data?.analytics?.dataset?.rows || "N/A"],
            ["Stations", data?.analytics?.station_count || "N/A"],
            [
              "Avg waiting",
              system.average_waiting_minutes == null
                ? "N/A"
                : `${system.average_waiting_minutes} min`,
            ],
            ["Peak load", system.peak_load ?? "N/A"],
          ].map(([label, value]) => (
            <div className="card" key={label}>
              <div className="kpi-label">{label}</div>
              <div className="result-value">{value}</div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          {data?.analytics?.notice || "N/A - required data unavailable"}
        </p>
      </section>
      <section className="card">
        <h2>System analytics</h2>
        <p className="muted" style={{ marginTop: 14 }}>
          {data?.analytics?.notice || "Not evaluated yet."}
        </p>
        <div style={{ marginTop: 18 }}>
          <div className="kpi-label">Peak configured power</div>
          <div className="result-value">
            {data?.analytics?.metrics?.peak_power_kw ?? "N/A"}
            {data?.analytics?.metrics?.peak_power_kw ? " kW" : ""}
          </div>
        </div>
      </section>
    </div>
  );
}

function About() {
  return (
    <section className="card">
      <div className="eyebrow">Q-EVFlow / Research boundary</div>
      <h2 style={{ marginTop: 10 }}>
        Hybrid charging optimization for a local laptop
      </h2>
      <p className="muted" style={{ maxWidth: 740, lineHeight: 1.7 }}>
        Q-EVFlow combines Random Forest demand prediction, K-Means station
        grouping, Dijkstra routing, QUBO assignment, and QAOA through a local
        simulator. It is a student research implementation, not a reproduction
        of another paper and not a claim of quantum speedup.
      </p>
      <div className="callout" style={{ maxWidth: 740 }}>
        No physical EV hardware, live traffic API, paid service, GPU, or cloud
        quantum credential is required. When the QAOA dependency is unavailable
        or a problem exceeds the configured local limit, the result is labeled
        classical_fallback.
      </div>
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState("Dashboard");
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [simulationResult, setSimulationResult] = useState(null);
  const loadDashboard = () => {
    setError("");
    setData(null);
    Promise.all([getDashboardData(), getHealth()])
      .then(([dashboard, status]) => {
        setData(dashboard);
        setHealth(status);
      })
      .catch(() =>
        setError(
          "The local API did not finish loading. Confirm ports 3000 and 8000, then retry.",
        ),
      );
  };
  useEffect(loadDashboard, []);
  const title = page === "Dashboard" ? "Charging network overview" : page;
  const renderPage = () => {
    if (!data)
      return (
        <div className="card loading">Loading local Q-EVFlow services...</div>
      );
    if (page === "Dashboard")
      return <Dashboard data={data} setPage={setPage} />;
    if (page === "EV Simulation")
      return (
        <Simulation
          evs={data.evs.evs}
          stations={data.stations.stations}
          onResult={setSimulationResult}
        />
      );
    if (page === "Charging Stations")
      return (
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Charging stations</h2>
              <span className="muted">
                Capacity, queue, power, and demand tiers
              </span>
            </div>
          </div>
          <StationTable stations={data.stations.stations} />
        </section>
      );
    if (page === "Nearby Real Stations")
      return <NearbyStations simulatedStations={data.stations.stations} />;
    if (page === "Demand Prediction") return <Analytics data={data} />;
    if (page === "Optimization")
      return (
        <section className="card">
          <h2>Optimization lab</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            Run the EV Simulation to create a bounded QUBO and compare the local
            QAOA attempt with the classical baseline.
          </p>
          <button
            className="primary"
            onClick={() => setPage("EV Simulation")}
            style={{ marginTop: 18 }}
          >
            Open simulation
          </button>
          {simulationResult && (
            <div className="callout" style={{ marginTop: 18 }}>
              Last solver:{" "}
              {simulationResult.optimization.qaoa_or_fallback.solver}. Feasible:{" "}
              {String(simulationResult.optimization.qaoa_or_fallback.feasible)}.
            </div>
          )}
        </section>
      );
    if (page === "ETA / Route")
      return (
        <section className="card">
          <h2>ETA and route engine</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            Dijkstra runs over the local simulated road graph. Use EV Simulation
            to calculate a route with traffic, queue, charging, and total time.
          </p>
        </section>
      );
    if (page === "Analytics") return <Analytics data={data} />;
    return <About />;
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Q-EVFlow</div>
          <span className="brand-sub">Quantum-assisted EV operations</span>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              className={page === item ? "active" : ""}
              onClick={() => setPage(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          Local simulator
          <br />
          No cloud credentials required
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Operations console</div>
            <h1>{title}</h1>
          </div>
          <div className="status">
            <span className="dot" />
            {health?.status === "ok"
              ? "Services connected"
              : "Local services offline"}
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error">
              {error}{" "}
              <button className="secondary" onClick={loadDashboard}>
                Retry connection
              </button>
            </div>
          )}
          {renderPage()}
        </div>
      </main>
    </div>
  );
}
