/**
 * js/config.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for all configurable values.
 * Edit this file to point the app at your greenhouse location
 * and your local sensor API endpoints.
 */

const CONFIG = {

  /* ── LOCATION ───────────────────────────────────────────────── */
  // Coordinates of your greenhouse (kept for possible future use)
  lat: 40.1872,
  lon: 44.5152,
  timezone: 'auto',   // or e.g. 'Europe/Yerevan'

  /* ── LOCAL SENSOR API ────────────────────────────────────────── */
  // Base URL of your meteo-station / PLC REST API.
  // If your station exposes a local web server, set this to its IP.
  // Example: 'http://192.168.1.100'
  // Leave empty to use simulated sensor data instead.
  sensorBaseUrl: '',

  // Endpoint paths on your sensor API
  sensorEndpoints: {
    climate:   '/api/climate',    // indoor temp, humidity, heating/cooling
    irrigation:'/api/irrigation', // valve states
    waterRoom: '/api/water',      // flow rate, recipe
    energyRoom:'/api/energy',     // boiler temp, program
  },

  /* ── WEATHER.COM PWS (weather) ───────────────────────────────── */
  weatherComBase: 'https://api.weather.com/v2/pws/observations/current',
  weatherComStationId: 'IKOTAY9',
  weatherComFormat: 'json',
  weatherComUnits: 's', // s = metric SI (C, m/s), e = imperial
  weatherComApiKey: '4a09500e731f432b89500e731f532b68',
  backendBaseUrl: 'http://localhost:3001',
  // Browser CORS may block direct calls to weather.com from static pages.
  // If that happens, app falls back to Open-Meteo to keep UI populated.
  openMeteoBase: 'https://api.open-meteo.com/v1/forecast',
  openMeteoParams:
    'current=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation' +
    '&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m',

  /* ── GAUGE RANGES ────────────────────────────────────────────── */
  // [min, max] for each gauge arc
  gaugeRanges: {
    weather:    [-8,  40],
    climate:    [15.5, 28],
    waterFlow:  [0,   10],
    energyTemp: [20, 105],
  },

  /* ── POLLING ─────────────────────────────────────────────────── */
  pollIntervalMs: 30_000,   // how often to auto-refresh (ms)
};
