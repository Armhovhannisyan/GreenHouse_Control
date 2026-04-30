const ClimateSectionPage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const SLUG_TO_SECTION = {
    'climate-strategy': 'Climate strategy',
    temperature: 'Temperature',
    humidity: 'Humidity',
    'mixing-valves': 'Mixing valves',
    'cooling-stages': 'Cooling stages',
    ventilation: 'Ventilation',
    'air-circulation': 'Air circulation',
    curtain: 'Curtain',
    customization: 'Customization',
    'crop-treatment': 'Crop treatment',
  };

  const SECTION_MAP = {
    'Climate strategy': [
      ['Current period', '4'],
      ['Mode', 'Automatic'],
      ['Night strategy', 'Enabled'],
      ['Algorithm', 'Adaptive'],
    ],
    Temperature: [
      ['Heating setpoint', '17 °C'],
      ['Cooling setpoint', '18 °C'],
      ['Pipe temperature', '26 °C'],
      ['Leaf temperature', '16.9 °C'],
    ],
    Humidity: [
      ['Relative humidity', '74 %'],
      ['Absolute humidity', '10.7 g/m³'],
      ['Humidity deficit', '3.8 g/m³'],
      ['Dew point', '12.1 °C'],
    ],
    'Mixing valves': [
      ['Valve command', '39 %'],
      ['Valve status', 'No limits'],
      ['Supply temp', '39 °C'],
      ['Max temp', '49 °C'],
    ],
    'Cooling stages': [
      ['Stage 1', '0 %'],
      ['Stage 2', '0 %'],
      ['Cooling enabled', 'No'],
      ['Cooling source', 'Off'],
    ],
    Ventilation: [
      ['Vent orientation 1', 'Wind'],
      ['Vent orientation 2', 'Lee'],
      ['Vent opening average', '8 %'],
      ['Wind speed', '1 m/s'],
    ],
    'Air circulation': [
      ['Fan group A', '100 %'],
      ['Fan group B', '100 %'],
      ['Control target', 'Humidity'],
      ['Status', 'Running'],
    ],
    Curtain: [
      ['Curtain position', '100 %'],
      ['Curtain mode', 'Night'],
      ['Energy screen', 'On'],
      ['Blackout screen', 'Off'],
    ],
    Customization: [
      ['Custom setpoint', 'Off'],
      ['Override heat', '—'],
      ['Override cool', '—'],
      ['Override humidity', '—'],
    ],
    'Crop treatment': [
      ['Treatment status', 'Off'],
      ['Recipe', 'Default'],
      ['Spray schedule', 'Inactive'],
      ['Last action', '—'],
    ],
  };

  function getSectionSlug() {
    return document.body && document.body.dataset && document.body.dataset.sectionSlug
      ? document.body.dataset.sectionSlug
      : '';
  }

  function getSectionName() {
    const slug = getSectionSlug();
    if (slug && SLUG_TO_SECTION[slug]) return SLUG_TO_SECTION[slug];
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    return section && SECTION_MAP[section] ? section : 'Climate strategy';
  }

  const STRATEGY_ACCORDION_SECTIONS = [
    { id: 'chart', label: 'Chart', showInfo: false, defaultOpen: false },
    { id: 'status', label: 'Status', showInfo: true, defaultOpen: false },
    { id: 'settings', label: 'Settings', showInfo: true, defaultOpen: false },
    { id: 'configuration', label: 'Configuration', showInfo: true, defaultOpen: true },
  ];

  const STRATEGY_ACCORDION_STORAGE_KEY = 'climateStrategyAccordion.v1';
  const STRATEGY_CONFIG_STORAGE_KEY = 'climateStrategyConfig.v1';
  let strategyStatusListenerBound = false;
  let strategyStatusTicker = null;
  const RAMPING_TYPE_OPTIONS = [
    { value: 'non-line-ramp', label: 'non line ramp' },
    { value: 'liner-ramp', label: 'liner ramp' },
    { value: 'gradient-curve', label: 'gradient curve' },
  ];

  function readStrategyAccordionState() {
    try {
      const raw = window.localStorage.getItem(STRATEGY_ACCORDION_STORAGE_KEY);
      if (!raw) return {};
      const map = JSON.parse(raw);
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function persistStrategyAccordionExpanded(toggleId, expanded) {
    try {
      const map = readStrategyAccordionState();
      map[toggleId] = Boolean(expanded);
      window.localStorage.setItem(STRATEGY_ACCORDION_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function strategyAccordionPlaceholder() {
    return '<p class="climate-strategy-placeholder">Content for this section will be added later.</p>';
  }

  function parsePeriodStartMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function parsePeriodRampMinutes(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim();
    if (!s) return 0;
    const n = Number(s.replace(',', '.'));
    if (Number.isFinite(n)) return Math.max(0, n * 60);
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (!m) return 0;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return 0;
    return Math.max(0, h * 60 + mm);
  }

  function currentPeriodLabelFromState() {
    if (typeof window.ClimateStrategyPeriods === 'undefined' || typeof window.ClimateStrategyPeriods.getState !== 'function') {
      return '—';
    }
    let periods;
    try {
      periods = window.ClimateStrategyPeriods.getState();
    } catch (e) {
      return '—';
    }
    if (!Array.isArray(periods)) return '—';
    const sched = [];
    let no = 0;
    periods.forEach((p) => {
      if (!p || !p.use || !p.startTime) return;
      const startMin = parsePeriodStartMinutes(p.startTime);
      if (startMin == null) return;
      no += 1;
      sched.push({ startMin, no, rampMin: parsePeriodRampMinutes(p.rampTime) });
    });
    if (!sched.length) return '—';
    sched.sort((a, b) => a.startMin - b.startMin);
    if (sched.length === 1) return 'P1';
    const now = new Date();
    const mod = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let idx = sched.length - 1;
    for (let i = 0; i < sched.length; i += 1) {
      if (sched[i].startMin <= mod) idx = i;
      else break;
    }
    const curr = sched[idx];
    const prev = sched[(idx - 1 + sched.length) % sched.length];
    let since = mod - curr.startMin;
    if (since < 0) since += 24 * 60;
    if (Number.isFinite(curr.rampMin) && curr.rampMin > 0 && since < curr.rampMin) {
      return 'P' + prev.no + ' -> P' + curr.no;
    }
    return 'P' + curr.no;
  }

  function renderStrategyStatusSection(root) {
    const host = root.querySelector('[data-accordion-body="status"]');
    if (!host) return;
    const current = currentPeriodLabelFromState();
    host.innerHTML = `
      <div class="weather-status-grid">
        <div class="weather-status-item">
          <div class="weather-status-label">Current period</div>
          <div class="weather-status-value">${current}</div>
        </div>
      </div>
    `;
  }

  function ensureStrategyStatusTicker(root) {
    if (strategyStatusTicker) return;
    strategyStatusTicker = window.setInterval(function () {
      renderStrategyStatusSection(root);
    }, 15000);
  }

  function readStrategyConfig() {
    const fallback = { rampingType: 'liner-ramp' };
    try {
      const raw = window.localStorage.getItem(STRATEGY_CONFIG_STORAGE_KEY);
      if (!raw) return fallback;
      const cfg = JSON.parse(raw);
      const val = cfg && typeof cfg.rampingType === 'string' ? cfg.rampingType : fallback.rampingType;
      const valid = RAMPING_TYPE_OPTIONS.some((o) => o.value === val);
      return { rampingType: valid ? val : fallback.rampingType };
    } catch (e) {
      return fallback;
    }
  }

  function persistStrategyConfig(next) {
    try {
      window.localStorage.setItem(STRATEGY_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function renderStrategyConfiguration(root) {
    const host = root.querySelector('[data-accordion-body="configuration"]');
    if (!host) return;
    const cfg = readStrategyConfig();
    const optionHtml = RAMPING_TYPE_OPTIONS.map((o) =>
      `<option value="${o.value}"${o.value === cfg.rampingType ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    host.innerHTML = `
      <div class="weather-config-grid">
        <div class="weather-config-row">
          <div class="weather-config-label">Ramping Type</div>
          <select class="weather-config-select" data-strategy-config="rampingType">
            ${optionHtml}
          </select>
        </div>
      </div>
    `;
  }

  function strategyAccordionAfterToggle(toggleId, expanded) {
    if (expanded && toggleId === 'strategy-chart') {
      window.requestAnimationFrame(function () {
        if (typeof window.ClimateStrategyChart !== 'undefined' && window.ClimateStrategyChart.resize) {
          window.ClimateStrategyChart.resize();
        }
      });
    }
  }

  function bindStrategyReportToggles(root) {
    root.addEventListener('click', function (e) {
      if (e.target.closest('.cfg-help')) {
        e.stopPropagation();
        return;
      }
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('strategy-') !== 0) return;
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistStrategyAccordionExpanded(id, expanded);
      strategyAccordionAfterToggle(id, expanded);
    });
    root.addEventListener('keydown', function (e) {
      if (e.target.closest('.cfg-help')) return;
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('strategy-') !== 0) return;
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistStrategyAccordionExpanded(id, expanded);
      strategyAccordionAfterToggle(id, expanded);
    });

    root.addEventListener('change', function (e) {
      const sel = e.target.closest('select[data-strategy-config="rampingType"]');
      if (!sel || !root.contains(sel)) return;
      const val = String(sel.value || '');
      if (!RAMPING_TYPE_OPTIONS.some((o) => o.value === val)) return;
      persistStrategyConfig({ rampingType: val });
    });

  }

  function renderClimateStrategyAccordion() {
    const root = document.getElementById('climateSectionGrid');
    if (!root) return;
    const saved = readStrategyAccordionState();
    const blocks = STRATEGY_ACCORDION_SECTIONS.map(function (sec) {
      const toggleId = 'strategy-' + sec.id;
      const bodyId = 'reportBody-' + toggleId;
      const savedVal = saved[toggleId];
      const expanded =
        typeof savedVal === 'boolean' ? savedVal : Boolean(sec.defaultOpen);
      const helpHtml = sec.showInfo
        ? '<span class="cfg-help" tabindex="0" title="Section information" aria-label="About this section">i</span>'
        : '';
      const titleInner = helpHtml
        ? '<span class="climate-strategy-title-text">' + sec.label + '</span>' + helpHtml
        : sec.label;
      const titleClass =
        'weather-report-title weather-report-toggle-title' +
        (sec.showInfo ? ' climate-strategy-report-title--split' : '');
      return (
        '<div class="weather-report-block">' +
        '<div class="' +
        titleClass +
        '" data-report-toggle="' +
        toggleId +
        '" role="button" tabindex="0" aria-expanded="' +
        (expanded ? 'true' : 'false') +
        '">' +
        titleInner +
        '</div>' +
        '<div class="weather-report-body' +
        (expanded ? '' : ' collapsed') +
        '" id="' +
        bodyId +
        '">' +
        '<div data-accordion-body="' +
        sec.id +
        '">' +
        (sec.id === 'settings' || sec.id === 'chart' ? '' : strategyAccordionPlaceholder()) +
        '</div>' +
        '</div>' +
        '</div>'
      );
    });
    root.innerHTML = blocks.join('');
    bindStrategyReportToggles(root);
    if (typeof window.ClimateStrategyPeriods !== 'undefined') {
      const settingsHost = root.querySelector('[data-accordion-body="settings"]');
      if (settingsHost) window.ClimateStrategyPeriods.mount(settingsHost);
    }
    if (typeof window.ClimateStrategyChart !== 'undefined') {
      const chartHost = root.querySelector('[data-accordion-body="chart"]');
      if (chartHost) window.ClimateStrategyChart.mount(chartHost);
      const chartBody = document.getElementById('reportBody-strategy-chart');
      if (
        chartBody &&
        !chartBody.classList.contains('collapsed') &&
        window.ClimateStrategyChart.resize
      ) {
        window.requestAnimationFrame(function () {
          window.ClimateStrategyChart.resize();
        });
      }
    }
    renderStrategyConfiguration(root);
    renderStrategyStatusSection(root);
    ensureStrategyStatusTicker(root);
    if (!strategyStatusListenerBound) {
      strategyStatusListenerBound = true;
      window.addEventListener('climate-strategy-periods-changed', function () {
        renderStrategyStatusSection(root);
      });
    }
  }

  function renderStatusBar(sectionName) {
    const bar = document.getElementById('climateSectionStatusBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="status-item"><div class="status-dot online"></div><span>Section details</span></div>
      <div class="status-item">Section: <span class="font-mono font-semibold">${sectionName}</span></div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
    `;
  }

  function renderCards(sectionName, weather, sensors) {
    const root = document.getElementById('climateSectionGrid');
    if (!root) return;
    const baseRows = SECTION_MAP[sectionName] || [];
    const temp = weather.temperature_2m ?? 0;
    const hum = weather.relative_humidity_2m ?? 0;
    const wind = weather.wind_speed_10m ?? 0;
    const ctemp = sensors.climate ? sensors.climate.temp : temp;
    const rhIn =
      sensors.climate && sensors.climate.humidity != null && Number.isFinite(Number(sensors.climate.humidity))
        ? Number(sensors.climate.humidity)
        : hum;

    const dynamicRows = [
      ['Outdoor temperature', `${temp} °C`],
      ['Outdoor humidity', `${hum} %`],
      ['Indoor temperature', `${ctemp} °C`],
      ['Indoor humidity', `${rhIn} %`],
      ['Wind speed', `${wind} m/s`],
    ];
    if (sensors.climate && sensors.climate.indoorProbeName) {
      dynamicRows.push(['Indoor probe (eWeLink)', sensors.climate.indoorProbeName]);
    }

    const cards = baseRows.concat(dynamicRows).map(([k, v]) => `
      <section class="climate-box">
        <div class="climate-title">${k}</div>
        <div class="climate-value-panel">${v}</div>
        <div class="climate-kv"><div>Live detail for <b>${sectionName}</b></div></div>
      </section>
    `).join('');

    root.innerHTML = cards;
  }

  async function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    const slug = getSectionSlug();
    const sectionName = getSectionName();
    const titleEl = document.getElementById('climateSectionTitle');
    if (titleEl) titleEl.textContent = sectionName;
    renderStatusBar(sectionName);
    const backBtn = document.querySelector('.climate-section-head a[href="climate.html"]');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = 'climate.html';
        }
      });
    }

    if (slug === 'climate-strategy') {
      renderClimateStrategyAccordion();
      return;
    }

    let weather = {};
    let sensors = {};
    try {
      const data = await WeatherAPI.fetch();
      weather = data.current || {};
      sensors = await SensorAPI.fetchAll(weather);
    } catch (err) {
      // show defaults when live data is unavailable
    }
    renderCards(sectionName, weather, sensors);
  }

  /**
   * Replace inner HTML of a climate-strategy accordion body (ids: chart, status, settings, configuration).
   */
  function setClimateStrategySectionContent(sectionId, htmlString) {
    const el = document.querySelector('[data-accordion-body="' + sectionId + '"]');
    if (el) el.innerHTML = htmlString;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, setClimateStrategySectionContent };
})();
