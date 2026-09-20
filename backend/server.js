import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fetchNearbyStations } from './services/nearbyStations.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

app.use(express.json());
app.use(cors());

app.get('/', (_request, response) => {
  response.json({
    name: 'Q-EVFlow API',
    status: 'ok',
    message: 'Use /api/health for the gateway health check.',
  });
});

async function forward(path, options = {}) {
  const timeout = path === '/optimization/solve' || path === '/simulation/run' ? 120000 : 15000;
  const response = await axios({ baseURL: mlServiceUrl, url: path, timeout, ...options });
  return response.data;
}

function asyncRoute(handler) {
  return async (request, response) => {
    try {
      response.json(await handler(request));
    } catch (error) {
      const status = error.response?.status || 503;
      const detail = error.response?.data?.detail || error.message || 'ML service unavailable';
      response.status(status).json({ error: detail, service: 'ml-service' });
    }
  };
}

app.get('/api/health', (_request, response) => {
  forward('/health')
    .then((ml) => response.json({ status: 'ok', gateway: 'ok', mlService: ml }))
    .catch(() => response.status(503).json({ status: 'degraded', gateway: 'ok', mlService: 'unavailable' }));
});

app.get('/api/stations', asyncRoute(() => forward('/stations')));
app.get('/api/stations/:id', asyncRoute(async (request) => {
  const result = await forward('/stations');
  const station = result.stations.find((item) => item.id === request.params.id);
  if (!station) throw Object.assign(new Error(`Unknown station: ${request.params.id}`), { response: { status: 404, data: { detail: 'Station not found' } } });
  return station;
}));
app.get('/api/evs', asyncRoute(() => forward('/evs')));
app.post('/api/eta', asyncRoute((request) => forward('/eta', { method: 'POST', data: request.body })));
app.post('/api/ml/predict-demand', asyncRoute((request) => forward('/ml/predict-demand', { method: 'POST', data: request.body })));
app.get('/api/ml/metrics', asyncRoute(() => forward('/ml/metrics')));
app.post('/api/ml/cluster-stations', asyncRoute((request) => forward('/ml/cluster-stations', { method: 'POST', data: request.body })));
app.post('/api/optimization/solve', asyncRoute((request) => forward('/optimization/solve', { method: 'POST', data: request.body })));
app.post('/api/recommendation', asyncRoute((request) => forward('/recommendation', { method: 'POST', data: request.body })));
app.get('/api/analytics', asyncRoute(() => forward('/analytics')));
app.post('/api/simulation/run', asyncRoute((request) => forward('/simulation/run', { method: 'POST', data: request.body })));

app.get('/api/nearby-stations', asyncRoute(async (request) => {
  const latitude = Number(request.query.latitude);
  const longitude = Number(request.query.longitude);
  const distanceKm = Number(request.query.distance || 25);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw Object.assign(new Error('latitude must be between -90 and 90'), { response: { status: 400 } });
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw Object.assign(new Error('longitude must be between -180 and 180'), { response: { status: 400 } });
  }
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 100) {
    throw Object.assign(new Error('distance must be greater than 0 and no more than 100 km'), { response: { status: 400 } });
  }
  return fetchNearbyStations({ latitude, longitude, distanceKm });
}));

app.use((error, _request, response, _next) => {
  response.status(500).json({ error: error.message || 'Unexpected gateway error' });
});

app.listen(port, () => {
  console.log(`Q-EVFlow backend listening on port ${port}`);
});
