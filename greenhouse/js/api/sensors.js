/**
 * js/api/sensors.js
 * ─────────────────────────────────────────────────────────────────
 * Reads data from your local greenhouse sensor / PLC API.
 *
 * REAL MODE  — set CONFIG.sensorBaseUrl to your station's IP, e.g.:
 *              'http://192.168.1.100'
 *              Each endpoint must return JSON matching the shapes
 *              described in the fetch*() functions below.
 *
 * SIM MODE   — if CONFIG.sensorBaseUrl is empty or the fetch fails,
 *              SensorAPI.fetchAll() falls back to realistic simulated
 *              values so the UI is always usable during development.
 *
 * Exported:
 *   SensorAPI.fetchAll(weatherCurrent) → Promise<SensorData>
 *
 * SensorData = {
 *   climate:    { temp, humidity, heating, cooling, indoorProbeName? }
 *   irrigation: { active, waiting }
 *   waterRoom:  { flow, status, recipe }
 *   energyRoom: { temp, mode, program }
 * }
 */

const SensorAPI = (() => {

  /* ── helpers ── */
  async function getJSON(path) {
    const url = CONFIG.sensorBaseUrl + path;
    const res = await window.fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Sensor API ${res.status} at ${path}`);
    return res.json();
  }

  /* ────────────────────────────────────────────────────────────
     REAL FETCH FUNCTIONS
     Each function calls one endpoint and normalises the response
     into the shape the UI expects. Adapt the field names to match
     whatever your station actually returns.
  ──────────────────────────────────────────────────────────── */

  async function fetchClimate() {
    // Expected JSON: { temperature: 19.2, humidity: 68, heating: false, cooling: false }
    const d = await getJSON(CONFIG.sensorEndpoints.climate);
    return {
      temp:     d.temperature ?? d.temp,
      humidity: d.humidity,
      heating:  d.heating ? 'Active' : 'No heating',
      cooling:  d.cooling ? 'Active' : 'No cooling',
    };
  }

  async function fetchIrrigation() {
    // Expected JSON: { valves_active: 0, valves_waiting: 0 }
    const d = await getJSON(CONFIG.sensorEndpoints.irrigation);
    return {
      active:  d.valves_active  === 0 ? 'No valves' : `${d.valves_active} active`,
      waiting: d.valves_waiting === 0 ? 'No valves' : `${d.valves_waiting} waiting`,
    };
  }

  async function fetchWaterRoom() {
    // Expected JSON: { flow_rate: 1.4, status: "running", recipe: 2 }
    const d = await getJSON(CONFIG.sensorEndpoints.waterRoom);
    return {
      flow:   Helpers.round(d.flow_rate ?? d.flow, 2),
      status: d.status === 'running' ? 'Running' : 'Off',
      recipe: d.recipe ?? 1,
    };
  }

  async function fetchEnergyRoom() {
    // Expected JSON: { boiler_temp: 88, mode: "Normal", custom_program: false }
    const d = await getJSON(CONFIG.sensorEndpoints.energyRoom);
    return {
      temp:    Helpers.round(d.boiler_temp ?? d.temp, 1),
      mode:    d.mode ?? 'Normal',
      program: d.custom_program ? 'On' : 'Off',
    };
  }

  /* ────────────────────────────────────────────────────────────
     SIMULATION FALLBACK
     Generates plausible values derived from real outdoor weather.
  ──────────────────────────────────────────────────────────── */
  function simulate(weather) {
    const t     = weather.temperature_2m ?? 12;
    const clim  = Helpers.round(t + 5 + (Math.random() - .5) * .8, 1);
    const flow  = Helpers.round(Math.random() * 2, 2);
    const boil  = Helpers.round(60 + Math.random() * 8, 1);

    return {
      climate: {
        temp:     clim,
        humidity: Math.round(55 + Math.random() * 20),
        heating:  clim < 17 ? 'Active' : 'No heating',
        cooling:  clim > 26 ? 'Active' : 'No cooling',
      },
      irrigation: {
        active:  'No valves',
        waiting: 'No valves',
      },
      waterRoom: {
        flow,
        status: flow > 0 ? 'Running' : 'Off',
        recipe: 1,
      },
      energyRoom: {
        temp:    boil,
        mode:    'Normal',
        program: 'Off',
      },
    };
  }

  async function overlaySonoffClimate(sensors) {
    if (typeof SonoffAPI === 'undefined') return sensors;
    var probe = null;
    try {
      probe = await SonoffAPI.fetchIndoorClimate();
    } catch (_e) {
      return sensors;
    }
    if (!probe) return sensors;
    var climate = Object.assign({}, sensors.climate);
    var applied = false;
    if (probe.temp != null && Number.isFinite(probe.temp)) {
      climate.temp = Helpers.round(probe.temp, 1);
      applied = true;
    }
    if (probe.humidity != null && Number.isFinite(probe.humidity)) {
      climate.humidity = Math.round(probe.humidity);
      applied = true;
    }
    if (applied && probe.deviceName) climate.indoorProbeName = probe.deviceName;
    return Object.assign({}, sensors, { climate: climate });
  }

  /* ────────────────────────────────────────────────────────────
     PUBLIC API
  ──────────────────────────────────────────────────────────── */

  /**
   * Fetch all sensor zones.
   * Tries real endpoints if CONFIG.sensorBaseUrl is set;
   * falls back to simulation on error or when URL is empty.
   *
   * @param {object} weatherCurrent  — current block from WeatherAPI.fetch()
   * @returns {Promise<SensorData>}
   */
  async function fetchAll(weatherCurrent) {
    var base;
    if (!CONFIG.sensorBaseUrl) {
      base = simulate(weatherCurrent);
    } else {
      try {
        const [climate, irrigation, waterRoom, energyRoom] = await Promise.all([
          fetchClimate(),
          fetchIrrigation(),
          fetchWaterRoom(),
          fetchEnergyRoom(),
        ]);
        base = { climate, irrigation, waterRoom, energyRoom };
      } catch (err) {
        console.warn('[SensorAPI] Real fetch failed, using simulation:', err.message);
        base = simulate(weatherCurrent);
      }
    }
    return overlaySonoffClimate(base);
  }

  return { fetchAll };
})();
