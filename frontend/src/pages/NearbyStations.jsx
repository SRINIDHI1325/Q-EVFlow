import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getNearbyStations } from "../services/api.js";

const DEFAULT_RADIUS = 25;

function formatDistance(value) {
  return value == null ? "N/A" : `${value.toFixed(2)} km`;
}

function startNavigation(origin, station) {
  const { latitude, longitude } = station.real_api_data;
  if (!origin || latitude == null || longitude == null) return;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${origin.latitude},${origin.longitude}`);
  url.searchParams.set("destination", `${latitude},${longitude}`);
  url.searchParams.set("travelmode", "driving");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function simulationFallback(stations) {
  return stations.map((station, index) => ({
    id: `sim-${station.id}`,
    source: "Q-EVFlow simulation",
    real_api_data: {
      name: station.name,
      latitude: null,
      longitude: null,
      distance_km: null,
      address: "Local simulated station",
      connector_types: [],
      available_power_kw: station.available_power_kw,
      availability_status: null,
      is_operational: null,
      operator: null,
    },
    qevflow_estimates: {
      eta_minutes: null,
      waiting_minutes: station.queue_length * 10,
      predicted_demand: station.predicted_demand,
      congestion: station.demand_tier,
      recommendation_score: index + 1,
      labels: {
        eta: "Simulation",
        waiting: "Estimated by Q-EVFlow simulation",
        demand: "Configured Q-EVFlow simulation",
        congestion: "Configured Q-EVFlow simulation",
      },
    },
  }));
}

function StationMap({ origin, stations }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  useEffect(() => {
    if (!origin || !mapRef.current) return undefined;
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView(
        [origin.latitude, origin.longitude],
        11,
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(mapInstance.current);
    }
    const map = mapInstance.current;
    map.setView([origin.latitude, origin.longitude], 11);
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });
    L.marker([origin.latitude, origin.longitude])
      .addTo(map)
      .bindPopup("Your current location");
    stations.forEach((station) => {
      const { latitude, longitude, name } = station.real_api_data;
      if (latitude != null && longitude != null)
        L.marker([latitude, longitude]).addTo(map).bindPopup(name);
    });
    return undefined;
  }, [origin, stations]);
  return (
    <div
      ref={mapRef}
      className="nearby-map"
      aria-label="Map of nearby charging stations"
    />
  );
}

export default function NearbyStations({ simulatedStations }) {
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [origin, setOrigin] = useState(null);
  const [stations, setStations] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const useFallback = (message, fallbackOrigin = null) => {
    setOrigin(fallbackOrigin);
    setStations(simulationFallback(simulatedStations));
    setNotice(
      "Live nearby station data unavailable. Showing Q-EVFlow simulation data.",
    );
    setError(message);
    setState("fallback");
  };

  const findNearby = () => {
    if (!navigator.geolocation) {
      useFallback("This browser does not provide geolocation.");
      return;
    }
    setState("locating");
    setError("");
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setOrigin(location);
        setState("loading");
        try {
          const result = await getNearbyStations({
            ...location,
            distance: radius,
          });
          if (!result.stations?.length) {
            useFallback(
              "No public stations were returned for this radius.",
              location,
            );
            return;
          }
          setStations(result.stations);
          setNotice(result.notice);
          setState("ready");
        } catch (requestError) {
          useFallback(
            requestError.response?.data?.error ||
              "The public station API could not be reached.",
            location,
          );
        }
      },
      (locationError) => {
        const messages = {
          1: "Location permission was denied.",
          2: "Your location is unavailable.",
          3: "Location request timed out.",
        };
        useFallback(
          messages[locationError.code] || "Unable to read your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  return (
    <div className="nearby-page">
      <section className="card nearby-controls">
        <div>
          <div className="eyebrow">Real API Data + Q-EVFlow estimates</div>
          <h2>Nearby EV Charging Stations</h2>
          <p className="muted">
            Open Charge Map provides station records. Q-EVFlow calculates
            distance and planning ETA; unavailable queue and demand fields stay
            unavailable.
          </p>
        </div>
        <div className="nearby-actions">
          <div className="field">
            <label htmlFor="nearby-radius">Search radius (km)</label>
            <input
              id="nearby-radius"
              type="number"
              min="1"
              max="100"
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
            />
          </div>
          <button
            className="primary"
            onClick={findNearby}
            disabled={state === "locating" || state === "loading"}
          >
            {state === "locating"
              ? "Requesting location..."
              : state === "loading"
                ? "Loading stations..."
                : "Find Nearby Stations"}
          </button>
        </div>
        {origin && (
          <div className="callout">
            Current location: {origin.latitude.toFixed(5)},{" "}
            {origin.longitude.toFixed(5)}. Location is used for this search
            only.
          </div>
        )}
        {notice && <div className="callout">{notice}</div>}
        {error && <div className="error">{error}</div>}
      </section>
      {origin &&
        stations.some((station) => station.real_api_data.latitude != null) && (
          <StationMap origin={origin} stations={stations} />
        )}
      <section className="card">
        <div className="section-head">
          <div>
            <h2>{stations.length} nearby stations</h2>
            <span className="muted">
              {state === "fallback"
                ? "Simulation fallback"
                : "Sorted by geographic distance"}
            </span>
          </div>
          <span className={`badge ${state === "ready" ? "low" : "moderate"}`}>
            {state === "ready" ? "Real API Data" : "Q-EVFlow Simulation"}
          </span>
        </div>
        {stations.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Distance</th>
                  <th>ETA</th>
                  <th>Address</th>
                  <th>Connectors</th>
                  <th>Power</th>
                  <th>Status</th>
                  <th>Estimate details</th>
                  <th>Navigation</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => {
                  const real = station.real_api_data;
                  const estimate = station.qevflow_estimates;
                  return (
                    <tr key={station.id}>
                      <td>
                        <strong>{real.name}</strong>
                        <br />
                        <span className="muted">{station.source}</span>
                      </td>
                      <td>{formatDistance(real.distance_km)}</td>
                      <td>
                        {estimate.eta_minutes == null
                          ? "N/A"
                          : `${estimate.eta_minutes} min`}
                        <br />
                        <span className="muted">{estimate.labels.eta}</span>
                      </td>
                      <td>{real.address || "N/A"}</td>
                      <td>
                        {real.connector_types?.length
                          ? real.connector_types.join(", ")
                          : "N/A"}
                      </td>
                      <td>
                        {real.available_power_kw == null
                          ? "N/A"
                          : `${real.available_power_kw} kW`}
                      </td>
                      <td>
                        {real.availability_status || "N/A - not supplied"}
                      </td>
                      <td>
                        {estimate.waiting_minutes == null
                          ? estimate.labels.waiting
                          : `${estimate.waiting_minutes} min`}
                        <br />
                        <span className="muted">{estimate.labels.demand}</span>
                      </td>
                      <td>
                        <button
                          className="secondary navigation-button"
                          disabled={
                            !origin ||
                            real.latitude == null ||
                            real.longitude == null
                          }
                          onClick={() => startNavigation(origin, station)}
                          title={
                            !origin || real.latitude == null
                              ? "Available for real stations after location is found"
                              : "Open driving directions in Google Maps"
                          }
                        >
                          Start navigation
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="callout">
            Click Find Nearby Stations to request location access and search the
            public station directory. The existing simulated station workflow
            remains available in EV Simulation.
          </div>
        )}
      </section>
    </div>
  );
}
