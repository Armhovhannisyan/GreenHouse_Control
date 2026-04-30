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

  /* ── SONOFF / eWeLink indoor probe (optional) ───────────────── */
  // When set, this deviceid is used for indoor temp & RH on the climate UI.
  // Leave empty to auto-pick the first device that reports temperature (and humidity if present).
  sonoffClimateDeviceId: '',
  // Set false to skip calling /api/sonoff/devices (PLC / sim only).
  useSonoffIndoorClimate: true,
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
    /* Indoor / climate arc: wide enough that typical Sonoff & winter readings still show green */
    climate:    [0, 40],
    waterFlow:  [0,   10],
    energyTemp: [20, 105],
    /* Climate page only — same scales as used on dashboard where applicable */
    humidity:   [0, 100],
    percent:    [0, 100],
    windSpeed:  [0, 20],
  },

  /* Climate strategy → Settings table layout (rem). periodSlotRem = width of each Period N data column (schedule + detail). */
  climateStrategyDetailColumns: {
    paramColRem: 11,
    subColRem: 5.4,
    periodSlotRem: 6.75,
    cornerRem: 2.25,
  },

  /* ── POLLING ─────────────────────────────────────────────────── */
  pollIntervalMs: 30_000,   // how often to auto-refresh (ms)
};
