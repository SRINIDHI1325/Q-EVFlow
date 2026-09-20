import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000/api', timeout: 30000 });

export async function getDashboardData() {
  const [stations, evs, analytics, metrics] = await Promise.all([
    api.get('/stations'),
    api.get('/evs'),
    api.get('/analytics'),
    api.get('/ml/metrics'),
  ]);
  return { stations: stations.data, evs: evs.data, analytics: analytics.data, metrics: metrics.data };
}

export async function runSimulation(payload) {
  const response = await api.post('/simulation/run', payload);
  return response.data;
}

export async function getHealth() {
  const response = await api.get('/health');
  return response.data;
}

export async function getNearbyStations({ latitude, longitude, distance }) {
  const response = await api.get('/nearby-stations', { params: { latitude, longitude, distance } });
  return response.data;
}
