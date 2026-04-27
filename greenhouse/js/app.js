/**
 * js/app.js
 * ─────────────────────────────────────────────────────────────────
 * Application entry point.
 * Bootstraps all components and orchestrates the data-fetch cycle.
 */

const App = (() => {
  const TOKEN_KEY = 'authToken.v1';

  let autoTimer   = null;
  let autoEnabled = true;

  /* ── Status bar ── */
  function renderStatusBar(state, weatherSource = 'api.weather.com') {
    const dotCls = { online: 'online', offline: 'offline', loading: 'loading' }[state] || 'loading';
    const label  = { online: 'Connected', offline: 'Offline — check network', loading: 'Fetching…' }[state] || '';

    document.getElementById('statusBar').innerHTML = `
      <div class="status-item">
        <div class="status-dot ${dotCls}" id="connDot"></div>
        <span id="connLabel">${label}</span>
      </div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
      <div class="status-item">Polling: <span class="font-mono font-semibold">${CONFIG.pollIntervalMs / 1000} s</span></div>
      <div class="status-item">
        Weather: <span class="font-mono font-semibold">${weatherSource}</span>
      </div>
      ${CONFIG.sensorBaseUrl
        ? `<div class="status-item">Sensors: <span class="font-mono font-semibold">${CONFIG.sensorBaseUrl}</span></div>`
        : `<div class="status-item text-muted">Sensors: simulated</div>`
      }
    `;
  }

  /* ── Actions bar ── */
  function renderActionsBar() {
    document.getElementById('actionsBar').innerHTML = `
      <button class="btn btn-primary" id="refreshBtn" title="Fetch latest data">
        <span id="refreshIcon">${Helpers.ICONS.refresh}</span>
        Refresh data
      </button>
      <button class="btn btn-secondary active-toggle" id="autoBtn">
        Auto-refresh: ON
      </button>
    `;

    document.getElementById('refreshBtn').addEventListener('click', fetchAll);
    document.getElementById('autoBtn').addEventListener('click', toggleAuto);
  }

  /* ── Spinning indicator ── */
  function setLoading(on) {
    const icon = document.getElementById('refreshIcon');
    if (!icon) return;
    icon.innerHTML = `<span class="${on ? 'spin-icon' : ''}">${Helpers.ICONS.refresh}</span>`;
  }

  /* ── Main data fetch ── */
  async function fetchAll() {
    setLoading(true);
    renderStatusBar('loading');
    if (typeof Logger !== 'undefined') Logger.action('Dashboard fetchAll started');

    try {
      const { current, hourly } = await WeatherAPI.fetch();
      const sensors             = await SensorAPI.fetchAll(current);

      Cards.update(current, sensors);
      if (typeof Charts !== 'undefined' && Charts && typeof Charts.update === 'function') {
        Charts.update(hourly);
      }
      Alerts.render(current, sensors);

      renderStatusBar('online', current.source || 'api.weather.com');
      document.getElementById('lastUpdated').textContent = Helpers.timeStr();
      if (typeof Logger !== 'undefined') {
        Logger.info('Dashboard data refreshed', {
          source: current.source || 'unknown',
          temp: current.temperature_2m,
          humidity: current.relative_humidity_2m,
          wind: current.wind_speed_10m,
        });
      }

    } catch (err) {
      console.error('[App] fetchAll error:', err);
      if (typeof Logger !== 'undefined') Logger.error('Dashboard fetchAll failed', err && err.message ? err.message : err);
      renderStatusBar('offline');
      const last = document.getElementById('lastUpdated');
      if (last) last.textContent = `Error: ${err && err.message ? err.message : 'fetch failed'}`;
    } finally {
      setLoading(false);
    }
  }

  /* ── Auto-refresh toggle ── */
  function toggleAuto() {
    autoEnabled = !autoEnabled;
    const btn = document.getElementById('autoBtn');

    if (autoEnabled) {
      autoTimer = setInterval(fetchAll, CONFIG.pollIntervalMs);
      btn.textContent = 'Auto-refresh: ON';
      btn.classList.add('active-toggle');
    } else {
      clearInterval(autoTimer);
      autoTimer = null;
      btn.textContent = 'Auto-refresh: OFF';
      btn.classList.remove('active-toggle');
    }
  }

  /* ── Bootstrap ── */
  function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    Sidebar.render();
    Cards.render();
    if (typeof Charts !== 'undefined' && Charts && typeof Charts.init === 'function') {
      try {
        Charts.init();
      } catch (err) {
        console.warn('[App] Charts init failed, continuing without charts:', err);
      }
    }
    renderStatusBar('loading');
    renderActionsBar();

    // First data load
    fetchAll();

    // Start auto-refresh
    autoTimer = setInterval(fetchAll, CONFIG.pollIntervalMs);
  }

  // Kick off when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { fetchAll };   // expose for manual calls from console
})();
