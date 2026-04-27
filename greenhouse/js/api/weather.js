/**
 * js/api/weather.js
 * ─────────────────────────────────────────────────────────────────
 * Frontend weather API client. Reads weather from local backend DB.
 *
 * Backend endpoint: GET /api/weather/current
 */
const WeatherAPI = (() => {
  const TOKEN_KEY = 'authToken.v1';

  function apiUrl(path) {
    const base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
    return `${base}${path}`;
  }

  function authFetch(url, options = {}) {
    const token = window.localStorage.getItem(TOKEN_KEY) || '';
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return window.fetch(url, { ...options, headers });
  }

  async function fetch() {
    const res = await authFetch(apiUrl('/api/weather/current'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Backend weather HTTP ${res.status}`);
    const payload = await res.json();
    return {
      current: payload.current || {},
      hourly: payload.hourly || {},
    };
  }

  return { fetch };
})();
