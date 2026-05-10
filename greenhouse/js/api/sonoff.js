/**
 * js/api/sonoff.js
 * Reads indoor temperature / humidity from eWeLink devices via the backend.
 * Backend: GET /api/sonoff/devices (Bearer auth).
 */
const SonoffAPI = (() => {
  const TOKEN_KEY = 'authToken.v1';

  function apiUrl(path) {
    const base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
    return `${base}${path}`;
  }

  function authFetch(url, options) {
    const token = window.localStorage.getItem(TOKEN_KEY) || '';
    const headers = Object.assign({}, (options && options.headers) || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    return window.fetch(url, Object.assign({}, options || {}, { headers: headers }));
  }

  /** Number(null) is 0 — never use raw Number() on API fields. */
  function finiteNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function pickDevice(devices) {
    if (!Array.isArray(devices) || !devices.length) return null;
    var id = String(CONFIG.sonoffClimateDeviceId || '').trim();
    if (id) {
      for (var i = 0; i < devices.length; i += 1) {
        if (String((devices[i] && devices[i].deviceid) || '') === id) return devices[i];
      }
    }
    function hasBoth(d) {
      return finiteNum(d && d.temperature) != null && finiteNum(d && d.humidity) != null;
    }
    for (var j = 0; j < devices.length; j += 1) {
      if (hasBoth(devices[j])) return devices[j];
    }
    for (var k = 0; k < devices.length; k += 1) {
      if (finiteNum(devices[k] && devices[k].temperature) != null) return devices[k];
    }
    for (var m = 0; m < devices.length; m += 1) {
      if (finiteNum(devices[m] && devices[m].humidity) != null) return devices[m];
    }
    return null;
  }

  /**
   * @returns {Promise<{ temp: number|null, humidity: number|null, deviceName: string|null, online: boolean }|null>}
   */
  async function fetchIndoorClimate() {
    if (CONFIG.useSonoffIndoorClimate === false) return null;
    if (!window.localStorage.getItem(TOKEN_KEY)) return null;
    try {
      var res = await authFetch(apiUrl('/api/sonoff/devices'), { cache: 'no-store' });
      if (!res.ok) return null;
      var body = await res.json();
      var d = pickDevice(body.devices || []);
      if (!d) return null;
      var temp = finiteNum(d.temperature);
      var humidity = finiteNum(d.humidity);
      var out = {
        temp: temp,
        humidity: humidity,
        deviceName: d.name || d.deviceid || null,
        online: d.online !== false,
      };
      if (out.temp == null && out.humidity == null) return null;
      return out;
    } catch (_err) {
      return null;
    }
  }

  async function fetchRelayDevices() {
    if (!window.localStorage.getItem(TOKEN_KEY)) return [];
    try {
      var res = await authFetch(apiUrl('/api/sonoff/devices'), { cache: 'no-store' });
      if (!res.ok) return [];
      var body = await res.json();
      return Array.isArray(body.devices) ? body.devices : [];
    } catch (_err) {
      return [];
    }
  }

  /** For UI that must distinguish HTTP errors from an empty device list. */
  async function fetchRelayDevicesWithStatus() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      return { ok: false, devices: [], error: 'Not logged in' };
    }
    try {
      var res = await authFetch(apiUrl('/api/sonoff/devices'), { cache: 'no-store' });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        var errMsg = body.error || body.details || 'HTTP ' + res.status;
        return { ok: false, devices: [], error: String(errMsg) };
      }
      return {
        ok: true,
        devices: Array.isArray(body.devices) ? body.devices : [],
        relayModes: body && body.relayModes && typeof body.relayModes === 'object' ? body.relayModes : {},
        error: null,
      };
    } catch (e) {
      return { ok: false, devices: [], relayModes: {}, error: e && e.message ? e.message : 'Network error' };
    }
  }

  async function controlRelay(deviceId, state, channel, sourceOrOptions) {
    var source = 'manual-override';
    var percentage = null;
    if (sourceOrOptions && typeof sourceOrOptions === 'object') {
      source = String(sourceOrOptions.source || 'manual-override').toLowerCase();
      if (sourceOrOptions.percentage != null && sourceOrOptions.percentage !== '') {
        var n = Number(sourceOrOptions.percentage);
        if (Number.isFinite(n)) {
          percentage = Math.max(0, Math.min(100, Math.round(n)));
        }
      }
    } else {
      source = String(sourceOrOptions || 'manual-override').toLowerCase();
    }
    var payload = {
      deviceId: String(deviceId || ''),
      state: String(state || '').toLowerCase(),
      channel: channel == null ? 1 : Number(channel),
      source: source,
    };
    if (percentage != null) payload.percentage = percentage;
    var res = await authFetch(apiUrl('/api/sonoff/control'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Control HTTP ' + res.status);
    return res.json();
  }

  async function setRelayMode(deviceId, channel, mode) {
    var payload = {
      deviceId: String(deviceId || ''),
      channel: channel == null ? 1 : Number(channel),
      mode: String(mode || '').toLowerCase(),
    };
    var res = await authFetch(apiUrl('/api/sonoff/relay-mode'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Relay mode HTTP ' + res.status);
    return res.json();
  }

  async function startVentMove(job) {
    var payload = Object.assign({}, job || {});
    var res = await authFetch(apiUrl('/api/sonoff/vent-move'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      var text = await res.text().catch(function () { return ''; });
      throw new Error(text || ('Vent move HTTP ' + res.status));
    }
    return res.json();
  }

  async function fetchVentState() {
    var res = await authFetch(apiUrl('/api/sonoff/vent-state'), { cache: 'no-store' });
    if (!res.ok) throw new Error('Vent state HTTP ' + res.status);
    return res.json();
  }

  async function updateVentState(patch) {
    var res = await authFetch(apiUrl('/api/sonoff/vent-state'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, patch || {})),
    });
    if (!res.ok) throw new Error('Vent state update HTTP ' + res.status);
    return res.json();
  }

  async function writeVentilationTemps(sample) {
    var payload = Object.assign({}, sample || {});
    var res = await authFetch(apiUrl('/api/influx/ventilation-temps'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Influx ventilation temps HTTP ' + res.status);
    return res.json();
  }

  async function fetchVentilationHistory(hours) {
    var h = Number(hours);
    var qHours = Number.isFinite(h) && h > 0 ? Math.min(14 * 24, Math.round(h)) : 6;
    var res = await authFetch(apiUrl('/api/influx/ventilation-history?hours=' + qHours), { cache: 'no-store' });
    if (!res.ok) throw new Error('Influx ventilation history HTTP ' + res.status);
    return res.json();
  }

  async function fetchVentilationPidState() {
    var res = await authFetch(apiUrl('/api/ventilation/pid-state'), { cache: 'no-store' });
    if (!res.ok) throw new Error('Ventilation PID state HTTP ' + res.status);
    return res.json();
  }

  async function updateVentilationPidConfig(patch) {
    var res = await authFetch(apiUrl('/api/ventilation/pid-config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, patch || {})),
    });
    if (!res.ok) throw new Error('Ventilation PID config HTTP ' + res.status);
    return res.json();
  }

  async function setVentilationMode(mode) {
    var res = await authFetch(apiUrl('/api/ventilation/mode'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: String(mode || '').toLowerCase() === 'manual' ? 'manual' : 'automatic' }),
    });
    if (!res.ok) throw new Error('Ventilation mode HTTP ' + res.status);
    return res.json();
  }

  async function setVentilationManualTarget(targetPct) {
    var res = await authFetch(apiUrl('/api/ventilation/manual-target'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPct: Number(targetPct) }),
    });
    if (!res.ok) throw new Error('Ventilation manual target HTTP ' + res.status);
    return res.json();
  }

  async function setVentilationManualHold(extendMs) {
    var res = await authFetch(apiUrl('/api/ventilation/manual-hold'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extendMs: Number(extendMs) }),
    });
    if (!res.ok) throw new Error('Ventilation manual hold HTTP ' + res.status);
    return res.json();
  }

  return {
    fetchIndoorClimate,
    fetchRelayDevices,
    fetchRelayDevicesWithStatus,
    controlRelay,
    setRelayMode,
    startVentMove,
    fetchVentState,
    updateVentState,
    fetchVentilationHistory,
    writeVentilationTemps,
    fetchVentilationPidState,
    updateVentilationPidConfig,
    setVentilationMode,
    setVentilationManualTarget,
    setVentilationManualHold,
  };
})();
