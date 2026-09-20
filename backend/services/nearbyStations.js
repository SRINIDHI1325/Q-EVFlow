import axios from 'axios';

const OPEN_CHARGE_MAP_URL = 'https://api.openchargemap.io/v3/poi/';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function haversineKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadiusKm = 6371;
  const radians = (value) => (value * Math.PI) / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function connectorTypes(item) {
  return (item.Connections || [])
    .map((connection) => connection.ConnectionType?.Title || connection.ConnectionType?.FormalName)
    .filter(Boolean)
    .filter((type, index, values) => values.indexOf(type) === index);
}

function availablePowerKw(item) {
  const powers = (item.Connections || [])
    .map((connection) => toNumber(connection.PowerKW))
    .filter((power) => power !== null);
  return powers.length ? Math.max(...powers) : null;
}

export function normalizeStation(item, origin) {
  const latitude = toNumber(item.AddressInfo?.Latitude);
  const longitude = toNumber(item.AddressInfo?.Longitude);
  if (latitude === null || longitude === null) return null;
  const distanceKm = haversineKm(origin.latitude, origin.longitude, latitude, longitude);
  const status = item.StatusType?.Title || null;
  return {
    id: item.ID ? `OCM-${item.ID}` : `OCM-${latitude}-${longitude}`,
    source: 'Open Charge Map',
    real_api_data: {
      name: item.AddressInfo?.Title || 'Unnamed charging station',
      latitude,
      longitude,
      distance_km: Number(distanceKm.toFixed(3)),
      address: [item.AddressInfo?.AddressLine1, item.AddressInfo?.Town, item.AddressInfo?.StateOrProvince, item.AddressInfo?.Postcode].filter(Boolean).join(', '),
      connector_types: connectorTypes(item),
      available_power_kw: availablePowerKw(item),
      availability_status: status,
      is_operational: typeof item.StatusType?.IsOperational === 'boolean' ? item.StatusType.IsOperational : null,
      operator: item.OperatorInfo?.Title || null,
      usage_type: item.UsageType?.Title || null,
      access_comments: item.AddressInfo?.AccessComments || null,
    },
    qevflow_estimates: {
      eta_minutes: Number(((distanceKm / 30) * 60).toFixed(1)),
      waiting_minutes: null,
      predicted_demand: null,
      congestion: null,
      recommendation_score: Number(distanceKm.toFixed(3)),
      labels: {
        eta: 'Estimated by Q-EVFlow using 30 km/h planning speed',
        waiting: 'N/A - queue data unavailable',
        demand: 'N/A - no station demand measurement supplied by API',
        congestion: 'N/A - no live congestion measurement supplied by API',
      },
    },
  };
}

function normalizeOpenStreetMapElement(item, origin) {
  const latitude = toNumber(item.lat ?? item.center?.lat);
  const longitude = toNumber(item.lon ?? item.center?.lon);
  if (latitude === null || longitude === null) return null;
  const tags = item.tags || {};
  const distanceKm = haversineKm(origin.latitude, origin.longitude, latitude, longitude);
  const connectorTypes = [tags.socket, tags.sockets, tags["socket:type2"], tags["socket:ccs"]].filter(Boolean).join(', ').split(',').map((value) => value.trim()).filter(Boolean);
  const power = toNumber(tags.maxpower || tags["charging_station:maxpower"] || tags["socket:output"]?.replace(/[^0-9.]/g, ''));
  return {
    id: `OSM-${item.type}-${item.id}`,
    source: 'OpenStreetMap Overpass',
    real_api_data: {
      name: tags.name || 'Unnamed charging station', latitude, longitude,
      distance_km: Number(distanceKm.toFixed(3)),
      address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:postcode"]].filter(Boolean).join(' ') || null,
      connector_types: connectorTypes,
      available_power_kw: power,
      availability_status: null,
      is_operational: null,
      operator: tags.operator || null,
      usage_type: null,
      access_comments: tags.access || null,
    },
    qevflow_estimates: {
      eta_minutes: Number(((distanceKm / 30) * 60).toFixed(1)), waiting_minutes: null, predicted_demand: null, congestion: null, recommendation_score: Number(distanceKm.toFixed(3)),
      labels: { eta: 'Estimated by Q-EVFlow using 30 km/h planning speed', waiting: 'N/A - queue data unavailable', demand: 'N/A - no station demand measurement supplied by API', congestion: 'N/A - no live congestion measurement supplied by API' },
    },
  };
}

async function fetchOpenStreetMapStations({ latitude, longitude, distanceKm, maxResults }) {
  const radiusMeters = Math.round(distanceKm * 1000);
  const query = `[out:json][timeout:15];(nwr[amenity=charging_station](around:${radiusMeters},${latitude},${longitude}););out center tags;`;
  const response = await axios.get('https://overpass-api.de/api/interpreter', { params: { data: query }, timeout: 20000, headers: { Accept: 'application/json', 'User-Agent': 'Q-EVFlow-local-student-project/1.0' } });
  const stations = (response.data.elements || []).map((item) => normalizeOpenStreetMapElement(item, { latitude, longitude })).filter(Boolean).sort((left, right) => left.real_api_data.distance_km - right.real_api_data.distance_km).slice(0, maxResults);
  return { source: 'OpenStreetMap Overpass', live_data: false, api_key_configured: false, origin: { latitude, longitude }, radius_km: distanceKm, count: stations.length, stations, notice: 'Station location and tagged connector/power fields come from OpenStreetMap. Availability, queue, demand, and congestion are not supplied unless explicitly tagged; ETA is estimated by Q-EVFlow.' };
}

export async function fetchNearbyStations({ latitude, longitude, distanceKm = 25, maxResults = 50 }) {
  const apiKey = process.env.OCM_API_KEY;
  const params = {
    output: 'json',
    latitude,
    longitude,
    distance: distanceKm,
    distanceunit: 'KM',
    maxresults: Math.min(Math.max(Number(maxResults) || 50, 1), 100),
    compact: true,
    verbose: false,
  };
  if (apiKey) params.key = apiKey;
  let response;
  try {
    response = await axios.get(OPEN_CHARGE_MAP_URL, { params, timeout: 12000, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (!apiKey && [401, 403, 406].includes(error.response?.status)) return fetchOpenStreetMapStations({ latitude, longitude, distanceKm, maxResults: params.maxresults });
    throw error;
  }
  const stations = (Array.isArray(response.data) ? response.data : [])
    .map((item) => normalizeStation(item, { latitude, longitude }))
    .filter(Boolean)
    .sort((left, right) => left.real_api_data.distance_km - right.real_api_data.distance_km);
  return {
    source: 'Open Charge Map',
    live_data: false,
    api_key_configured: Boolean(apiKey),
    origin: { latitude, longitude },
    radius_km: distanceKm,
    count: stations.length,
    stations,
    notice: 'Station location and connector fields come from Open Charge Map. ETA is estimated by Q-EVFlow; queue, demand, and congestion are not invented when unavailable.',
  };
}
