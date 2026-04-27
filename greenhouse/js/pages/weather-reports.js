const WeatherReportsPage = (() => {
  const METRIC_META = {
    temperature_2m: { label: 'Temperature (°C)', color: '#2e9e5b' },
    relative_humidity_2m: { label: 'Humidity (%)', color: '#4da6d6' },
    absolute_humidity_2m: { label: 'Outside absolute humidity (g/m³)', color: '#8a5dd8' },
    wind_speed_10m: { label: 'Wind speed (m/s)', color: '#0a7c6e' },
    winddir: { label: 'Wind direction (°)', color: '#d96f17' },
    shortwave_radiation: { label: 'Light (W/m²)', color: '#e8a020' },
    rain_status: { label: 'Rain status (on/off)', color: '#173f8a' },
    light_accum_jcm2: { label: 'Outside light accumulation (J/cm²)', color: '#b79b16' },
  };

  let chart = null;
  let historyRows = [];
  let activeMetrics = new Set(Object.keys(METRIC_META));
  let filteredRows = [];
  let filteredLabels = [];
  let selectedMetric = 'all';
  let selectedRange = 6;
  let chartCollapsed = false;
  const WEATHER_CONFIG_KEY = 'weatherConfig.v1';
  const TOKEN_KEY = 'authToken.v1';
  const DEFAULT_CONFIG = {
    outsideTempOffset: 0,
    outsideHumidityOffset: 0,
    outsideLightZeroOffset: 0,
    outsideLightSpanPercent: 100,
    maxLightChangePerMinute: 100,
    rainStatusOffDelayMin: 1,
    rainSensorSensitivity: 'NORMAL',
  };
  let weatherConfig = { ...DEFAULT_CONFIG };

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

  async function loadHistory(hours = 168) {
    if (typeof Logger !== 'undefined') Logger.action('Loading weather history', { hours });
    const res = await authFetch(apiUrl(`/api/weather/history?hours=${hours}`), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Weather history HTTP ${res.status}`);
    const json = await res.json();
    historyRows = enrichHistoryRows(json.observations || []);
    if (typeof Logger !== 'undefined') Logger.info('Weather history loaded', { count: historyRows.length });
  }

  function enrichHistoryRows(rows) {
    const sorted = rows.slice().sort((a, b) => Date.parse(a.obsTimeUtc || '') - Date.parse(b.obsTimeUtc || ''));
    let prevTs = null;
    let filteredLight = null;
    let dayKey = '';
    let accum = 0;
    let rainHoldUntil = 0;
    const sensitivityThresholds = {
      VERY_LIGHT: 0.01,
      LIGHT: 0.05,
      NORMAL: 0.2,
      HEAVY: 0.5,
      VERY_HEAVY: 1.0,
    };
    const rainThreshold = sensitivityThresholds[weatherConfig.rainSensorSensitivity] || sensitivityThresholds.NORMAL;
    return sorted.map((row) => {
      const ts = Date.parse(row.obsTimeUtc || '');
      const d = Number.isFinite(ts) ? new Date(ts) : null;
      const key = d ? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` : '';
      if (key !== dayKey) {
        dayKey = key;
        accum = 0;
        prevTs = ts;
      }
      let dt = 0;
      if (Number.isFinite(prevTs) && Number.isFinite(ts)) {
        dt = Math.max(0, (ts - prevTs) / 1000);
      }
      const rawPower = Number(row.shortwave_radiation);
      const spanFactor = Math.max(0, Number(weatherConfig.outsideLightSpanPercent || 100)) / 100;
      const zeroOffset = Number(weatherConfig.outsideLightZeroOffset || 0);
      const adjustedLight = Number.isFinite(rawPower)
        ? Math.max(0, (rawPower + zeroOffset) * spanFactor)
        : null;
      const dtMin = dt / 60;
      const maxDeltaPerMin = Math.max(0, Number(weatherConfig.maxLightChangePerMinute || 0));
      if (adjustedLight == null) {
        filteredLight = filteredLight == null ? null : filteredLight;
      } else if (filteredLight == null || maxDeltaPerMin === 0 || dtMin <= 0) {
        filteredLight = adjustedLight;
      } else {
        const maxStep = maxDeltaPerMin * dtMin;
        const diff = adjustedLight - filteredLight;
        if (Math.abs(diff) <= maxStep) filteredLight = adjustedLight;
        else filteredLight += Math.sign(diff) * maxStep;
      }
      if (Number.isFinite(filteredLight) && dt > 0) {
        accum += (filteredLight * dt) / 10000;
      }
      prevTs = ts;
      const precipRate = Number(row.precipRate);
      const isRainingNow = Number.isFinite(precipRate) && precipRate > rainThreshold;
      const offDelayMs = Math.max(0, Number(weatherConfig.rainStatusOffDelayMin || 0)) * 60 * 1000;
      if (isRainingNow && Number.isFinite(ts)) {
        rainHoldUntil = ts + offDelayMs;
      }
      const rainOn = isRainingNow || (Number.isFinite(ts) && ts <= rainHoldUntil);
      const rawTemp = Number(row.temperature_2m);
      const rawRh = Number(row.relative_humidity_2m);
      const adjustedTemp = Number.isFinite(rawTemp) ? rawTemp + Number(weatherConfig.outsideTempOffset || 0) : rawTemp;
      const adjustedRh = Number.isFinite(rawRh)
        ? Math.max(0, Math.min(100, rawRh + Number(weatherConfig.outsideHumidityOffset || 0)))
        : rawRh;
      return {
        ...row,
        temperature_2m: Number.isFinite(adjustedTemp) ? +adjustedTemp.toFixed(2) : row.temperature_2m,
        relative_humidity_2m: Number.isFinite(adjustedRh) ? +adjustedRh.toFixed(2) : row.relative_humidity_2m,
        shortwave_radiation: Number.isFinite(filteredLight) ? +filteredLight.toFixed(2) : row.shortwave_radiation,
        _rain_status: rainOn ? 1 : 0,
        _light_accum_jcm2: +accum.toFixed(3),
      };
    });
  }

  function loadWeatherConfig() {
    try {
      const raw = window.localStorage.getItem(WEATHER_CONFIG_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      weatherConfig = { ...DEFAULT_CONFIG, ...parsed };
    } catch (_err) {
      weatherConfig = { ...DEFAULT_CONFIG };
    }
  }

  function saveWeatherConfig() {
    window.localStorage.setItem(WEATHER_CONFIG_KEY, JSON.stringify(weatherConfig));
  }

  function renderConfigSection() {
    const root = document.getElementById('weatherConfigRoot');
    if (!root) return;
    const help = {
      outsideTempOffset: 'Calibration offset for outside temperature sensor. Example: if reading is 0.8 °C too high, set -0.8.',
      outsideHumidityOffset: 'Calibration offset for outside humidity sensor. Positive increases reading, negative decreases.',
      outsideLightZeroOffset: 'Used when light is not 0 at night. This offset is added/subtracted to correct zero point.',
      outsideLightSpanPercent: 'Ratio calibration for light sensor. 100% is normal. Increase/decrease proportionally if light is too low/high.',
      maxLightChangePerMinute: 'Limits how fast filtered light can change each minute. 0 = instant/no filtering.',
      rainStatusOffDelayMin: 'Keeps rain status ON for this many minutes after rain stops to avoid rapid toggling.',
      rainSensorSensitivity: 'How much rain triggers sensor. VERY_LIGHT triggers sooner, VERY_HEAVY requires more rain.',
    };
    const rows = [
      ['Outside temperature calibration offset', 'outsideTempOffset', 'number', '0.1', '°C'],
      ['Outside humidity calibration offset', 'outsideHumidityOffset', 'number', '0.1', '%'],
      ['Outside light sensor zero calibration offset', 'outsideLightZeroOffset', 'number', '0.1', 'W/m²'],
      ['Outside light sensor span calibration adjustment', 'outsideLightSpanPercent', 'number', '1', '%'],
      ['Maximum light intensity change per minute', 'maxLightChangePerMinute', 'number', '1', 'W/m²'],
      ['Rain status off delay', 'rainStatusOffDelayMin', 'number', '1', 'min'],
    ];
    const sensitivityOptions = ['VERY_LIGHT', 'LIGHT', 'NORMAL', 'HEAVY', 'VERY_HEAVY']
      .map((s) => `<option value="${s}" ${weatherConfig.rainSensorSensitivity === s ? 'selected' : ''}>${s}</option>`)
      .join('');
    root.innerHTML = `
      <div class="weather-config-grid">
        ${rows.map(([label, key, type, step, unit]) => `
          <div class="weather-config-row">
            <div class="weather-config-label">
              ${label}
              <span class="cfg-help" tabindex="0">i
                <span class="cfg-help-tip">${help[key] || ''}</span>
              </span>
            </div>
            <input class="weather-config-input" data-cfg="${key}" type="${type}" step="${step}" value="${weatherConfig[key]}"> 
          </div>
        `).join('')}
        <div class="weather-config-row">
          <div class="weather-config-label">
            Rain sensor sensitivity
            <span class="cfg-help" tabindex="0">i
              <span class="cfg-help-tip">${help.rainSensorSensitivity}</span>
            </span>
          </div>
          <select class="weather-config-select" data-cfg="rainSensorSensitivity">${sensitivityOptions}</select>
        </div>
      </div>
      <div class="weather-config-actions">
        <button type="button" class="btn btn-primary" id="weatherCfgApply">Apply</button>
        <button type="button" class="btn btn-secondary" id="weatherCfgReset">Reset defaults</button>
      </div>
    `;
  }

  function ensureChart() {
    if (chart || typeof Chart === 'undefined') return;
    const canvas = document.getElementById('weatherSingleChart');
    if (!canvas) return;
    const baseMetric = selectedMetric === 'all' ? 'temperature_2m' : selectedMetric;
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: METRIC_META[baseMetric].label,
          data: [],
          borderColor: METRIC_META[baseMetric].color,
          backgroundColor: 'rgba(77,166,214,.12)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        onHover: (_evt, _els, chartRef) => {
          if (!filteredRows.length) return;
          const active = chartRef.tooltip && chartRef.tooltip.dataPoints && chartRef.tooltip.dataPoints[0];
          if (active && Number.isFinite(active.dataIndex)) {
            updateQuickAnalysisValues(active.dataIndex);
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10 } },
        },
      },
    });
  }

  function redrawChart() {
    if (!chart) return;
    const now = Date.now();
    const from = now - selectedRange * 60 * 60 * 1000;
    const filtered = historyRows.filter((r) => {
      const t = Date.parse(r.obsTimeUtc || '');
      return Number.isFinite(t) && t >= from;
    });

    const labels = filtered.map((r) => {
      const d = new Date(r.obsTimeUtc);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    });
    filteredRows = filtered;
    filteredLabels = labels;

    chart.data.labels = labels;
    if (selectedMetric === 'all') {
      chart.data.datasets = [
        {
          label: METRIC_META.temperature_2m.label,
          data: filtered.map((r) => r.temperature_2m),
          borderColor: METRIC_META.temperature_2m.color,
          backgroundColor: 'rgba(46,158,91,.08)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'yTemp',
        },
        {
          label: METRIC_META.relative_humidity_2m.label,
          data: filtered.map((r) => r.relative_humidity_2m),
          borderColor: METRIC_META.relative_humidity_2m.color,
          backgroundColor: 'rgba(77,166,214,.08)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'yHum',
        },
        {
          label: METRIC_META.absolute_humidity_2m.label,
          data: filtered.map((r) => absoluteHumidityFromRow(r)),
          borderColor: METRIC_META.absolute_humidity_2m.color,
          backgroundColor: 'rgba(138,93,216,.08)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'yAbs',
        },
        {
          label: METRIC_META.wind_speed_10m.label,
          data: filtered.map((r) => r.wind_speed_10m),
          borderColor: METRIC_META.wind_speed_10m.color,
          backgroundColor: 'rgba(10,124,110,.08)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'yWind',
        },
        {
          label: METRIC_META.winddir.label,
          data: filtered.map((r) => r.winddir),
          borderColor: METRIC_META.winddir.color,
          backgroundColor: 'rgba(217,111,23,.08)',
          borderWidth: 1.5,
          tension: 0.2,
          pointRadius: 0,
          yAxisID: 'yDir',
        },
        {
          label: METRIC_META.shortwave_radiation.label,
          data: filtered.map((r) => r.shortwave_radiation ?? 0),
          borderColor: METRIC_META.shortwave_radiation.color,
          backgroundColor: 'rgba(232,160,32,.08)',
          borderWidth: 1.5,
          tension: 0.35,
          pointRadius: 0,
          yAxisID: 'yLight',
        },
        {
          label: METRIC_META.rain_status.label,
          data: filtered.map((r) => r._rain_status),
          borderColor: METRIC_META.rain_status.color,
          backgroundColor: 'rgba(23,63,138,.08)',
          borderWidth: 1.5,
          stepped: true,
          tension: 0,
          pointRadius: 0,
          yAxisID: 'yRain',
        },
        {
          label: METRIC_META.light_accum_jcm2.label,
          data: filtered.map((r) => r._light_accum_jcm2),
          borderColor: METRIC_META.light_accum_jcm2.color,
          backgroundColor: 'rgba(183,155,22,.08)',
          borderWidth: 1.5,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'yAccum',
        },
      ];
      chart.data.datasets.forEach((ds) => {
        const key = Object.keys(METRIC_META).find((k) => METRIC_META[k].label === ds.label);
        if (key) ds.hidden = !activeMetrics.has(key);
      });
      chart.options.scales = {
        x: { ticks: { maxTicksLimit: 10 } },
        yTemp: { type: 'linear', position: 'left', title: { display: true, text: '°C' } },
        yHum: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' } },
        yAbs: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
        yWind: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
        yDir: { type: 'linear', min: 0, max: 360, position: 'right', grid: { drawOnChartArea: false }, display: false },
        yLight: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
        yRain: { type: 'linear', min: 0, max: 1, position: 'right', grid: { drawOnChartArea: false }, display: false },
        yAccum: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, display: false },
      };
    } else {
      chart.data.datasets = [{
        label: METRIC_META[selectedMetric].label,
        data: filtered.map((r) => {
          if (selectedMetric === 'shortwave_radiation') return r.shortwave_radiation ?? 0;
          return r[selectedMetric];
        }),
        borderColor: METRIC_META[selectedMetric].color,
        backgroundColor: 'rgba(77,166,214,.12)',
        borderWidth: 1.5,
        tension: 0.35,
        pointRadius: 0,
      }];
      chart.options.scales = {
        x: { ticks: { maxTicksLimit: 10 } },
      };
    }
    chart.update();
    renderQuickAnalysis();
    if (filteredRows.length) {
      updateQuickAnalysisValues(filteredRows.length - 1);
    }
  }

  function calcAbsoluteHumidity(tempC, rhPct) {
    const t = Number(tempC);
    const rh = Number(rhPct);
    if (!Number.isFinite(t) || !Number.isFinite(rh)) return null;
    const sat = 6.112 * Math.exp((17.67 * t) / (t + 243.5));
    const ah = (sat * (rh / 100) * 2.1674) / (273.15 + t);
    return +ah.toFixed(2);
  }

  function absoluteHumidityFromRow(row) {
    if (!row) return null;
    if (row.absolute_humidity_2m != null && Number.isFinite(Number(row.absolute_humidity_2m))) {
      return Number(row.absolute_humidity_2m);
    }
    return calcAbsoluteHumidity(row.temperature_2m, row.relative_humidity_2m);
  }

  function metricValue(row, metric) {
    if (!row) return '—';
    const fmt = (v, d = 1) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(d) : '—';
    };
    if (metric === 'temperature_2m') return `${fmt(row.temperature_2m, 1)} °C`;
    if (metric === 'relative_humidity_2m') return `${fmt(row.relative_humidity_2m, 0)} %`;
    if (metric === 'absolute_humidity_2m') {
      const ah = absoluteHumidityFromRow(row);
      return `${ah ?? '—'} g/m³`;
    }
    if (metric === 'wind_speed_10m') return `${fmt(row.wind_speed_10m, 1)} m/s`;
    if (metric === 'winddir') return `${row.winddir ?? '—'}°`;
    if (metric === 'rain_status') return row._rain_status === 1 ? 'On' : 'Off';
    if (metric === 'light_accum_jcm2') return `${row._light_accum_jcm2 ?? '—'} J/cm²`;
    return `${fmt(row.shortwave_radiation, 1)} W/m²`;
  }

  function renderQuickAnalysis() {
    const list = document.getElementById('quickAnalysisList');
    const toggleAllLabel = document.getElementById('qaToggleAllLabel');
    if (!list) return;
    const metrics = selectedMetric === 'all' ? Object.keys(METRIC_META) : [selectedMetric];
    if (toggleAllLabel) {
      const allSelected = metrics.every((m) => activeMetrics.has(m));
      const action = allSelected ? 'deselect all' : 'select all';
      toggleAllLabel.textContent = `Quick analysis (${action})`;
      toggleAllLabel.setAttribute('aria-disabled', String(selectedMetric !== 'all'));
    }
    list.innerHTML = metrics.map((m) => `
      <div class="qa-row ${activeMetrics.has(m) ? '' : 'disabled'}" data-qa-metric="${m}">
        <span class="qa-toggle" style="background:${METRIC_META[m].color}"></span>
        <span class="qa-label">${METRIC_META[m].label}</span>
        <span class="qa-value" id="qaVal-${m}">—</span>
      </div>
    `).join('');
  }

  function updateQuickAnalysisValues(index) {
    const timeEl = document.getElementById('quickAnalysisTime');
    if (timeEl) {
      timeEl.textContent = filteredLabels[index] || 'Latest';
    }
    const metrics = selectedMetric === 'all' ? Object.keys(METRIC_META) : [selectedMetric];
    metrics.forEach((m) => {
      const el = document.getElementById(`qaVal-${m}`);
      if (!el) return;
      el.textContent = metricValue(filteredRows[index], m);
    });
  }

  function renderCurrentStatus() {
    const grid = document.getElementById('weatherStatusGrid');
    if (!grid) return;
    const row = historyRows.length ? historyRows[historyRows.length - 1] : null;
    if (!row) {
      grid.innerHTML = '<div class="weather-status-item"><div class="weather-status-label">Status</div><div class="weather-status-value">No data</div></div>';
      return;
    }
    const absoluteHumidity = absoluteHumidityFromRow(row);
    const temp = Number(row.temperature_2m);
    const rh = Number(row.relative_humidity_2m);
    const wind = Number(row.wind_speed_10m);
    const light = Number(row.shortwave_radiation);
    const items = [
      ['Temperature', `${Number.isFinite(temp) ? temp.toFixed(1) : '—'} °C`],
      ['Relative humidity', `${Number.isFinite(rh) ? rh.toFixed(0) : '—'} %`],
      ['Absolute humidity', `${absoluteHumidity ?? '—'} g/m³`],
      ['Wind speed', `${Number.isFinite(wind) ? wind.toFixed(1) : '—'} m/s`],
      ['Wind direction', `${row.winddir ?? '—'}°`],
      ['Rain status', row._rain_status === 1 ? 'On' : 'Off'],
      ['Outside light intensity', `${Number.isFinite(light) ? light.toFixed(1) : '—'} W/m²`],
      ['Light accumulation today', `${row._light_accum_jcm2 ?? '—'} J/cm²`],
      ['Pressure', `${row.pressure ?? '—'}`],
      ['Observed at', row.obsTimeLocal || row.obsTimeUtc || '—'],
    ];
    grid.innerHTML = items.map(([label, value]) => `
      <div class="weather-status-item">
        <div class="weather-status-label">${label}</div>
        <div class="weather-status-value">${value}</div>
      </div>
    `).join('');
  }

  function value(v, unit, digits = 1) {
    if (v == null || Number.isNaN(v)) return `— ${unit}`;
    return `${Number(v).toFixed(digits)} ${unit}`;
  }

  function pct(v) {
    if (v == null || Number.isNaN(v)) return '— %';
    return `${Math.round(Number(v))} %`;
  }

  function renderStatus(text) {
    const el = document.getElementById('weatherStatusBar');
    if (!el) return;
    el.innerHTML = `
      <div class="status-item">
        <div class="status-dot online"></div>
        <span>${text}</span>
      </div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
      <div class="status-item">Source: <span class="font-mono font-semibold">local-db</span></div>
    `;
  }

  function section(title, rows, sectionId) {
    const body = rows
      .map((r) => `<tr><td>${r.name}</td><td>${r.y}</td><td>${r.t}</td></tr>`)
      .join('');
    return `
      <div class="weather-report-block">
        <div class="weather-report-title weather-report-toggle-title" data-report-toggle="${sectionId}" role="button" tabindex="0" aria-expanded="true">${title}</div>
        <div class="weather-report-body" id="reportBody-${sectionId}">
          <table class="weather-report-table">
            <thead><tr><th></th><th>yesterday</th><th>today</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderReports(data) {
    const y = data.yesterday || {};
    const t = data.today || {};
    const root = document.getElementById('weatherReportsRoot');
    if (!root) return;

    root.innerHTML = [
      section('Outside temperature report', [
        { name: 'maximum outside temperature', y: value(y.temperature && y.temperature.max, '°C'), t: value(t.temperature && t.temperature.max, '°C') },
        { name: 'minimum outside temperature', y: value(y.temperature && y.temperature.min, '°C'), t: value(t.temperature && t.temperature.min, '°C') },
        { name: 'average daytime outside temperature', y: value(y.temperature && y.temperature.avg, '°C'), t: value(t.temperature && t.temperature.avg, '°C') },
        { name: 'average nighttime outside temperature', y: value(y.temperature && y.temperature.avgNight, '°C'), t: value(t.temperature && t.temperature.avgNight, '°C') },
      ], 'temperature'),
      section('Outside humidity report', [
        { name: 'maximum outside relative humidity', y: pct(y.humidity && y.humidity.max), t: pct(t.humidity && t.humidity.max) },
        { name: 'minimum outside relative humidity', y: pct(y.humidity && y.humidity.min), t: pct(t.humidity && t.humidity.min) },
        { name: 'average day time outside humidity', y: pct(y.humidity && y.humidity.avgDay), t: pct(t.humidity && t.humidity.avgDay) },
        { name: 'average night time outside humidity', y: pct(y.humidity && y.humidity.avgNight), t: pct(t.humidity && t.humidity.avgNight) },
      ], 'humidity'),
      section('Sunlight report', [
        { name: 'maximum outside light intensity', y: value(y.sunlight && y.sunlight.maxLight, 'W/m²', 0), t: value(t.sunlight && t.sunlight.maxLight, 'W/m²', 0) },
        { name: 'outside light accumulation', y: value(y.sunlight && y.sunlight.accumulation, 'J/cm²', 0), t: value(t.sunlight && t.sunlight.accumulation, 'J/cm²', 0) },
        { name: 'sunrise', y: (y.sunlight && y.sunlight.sunrise) || '—', t: (t.sunlight && t.sunlight.sunrise) || '—' },
        { name: 'sunset', y: (y.sunlight && y.sunlight.sunset) || '—', t: (t.sunlight && t.sunlight.sunset) || '—' },
      ], 'sunlight'),
      section('Wind report', [
        { name: 'maximum wind speed', y: value(y.wind && y.wind.max, 'm/s'), t: value(t.wind && t.wind.max, 'm/s') },
        { name: 'average wind speed', y: value(y.wind && y.wind.avg, 'm/s'), t: value(t.wind && t.wind.avg, 'm/s') },
      ], 'wind'),
      section('Rain report', [
        { name: 'average rain rate', y: value(y.rain && y.rain.avgRate, 'mm/h'), t: value(t.rain && t.rain.avgRate, 'mm/h') },
        { name: 'total outside rain', y: value(y.rain && y.rain.total, 'mm', 1), t: value(t.rain && t.rain.total, 'mm', 1) },
      ], 'rain'),
    ].join('');
  }

  async function loadReports() {
    try {
      const res = await authFetch(apiUrl('/api/weather/reports'), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Weather reports HTTP ${res.status}`);
      const data = await res.json();
      renderReports(data);
      renderStatus(`DB rows today: ${data.countToday || 0}, yesterday: ${data.countYesterday || 0}`);
      if (typeof Logger !== 'undefined') Logger.info('Weather reports loaded', { today: data.countToday, yesterday: data.countYesterday });
    } catch (err) {
      if (typeof Logger !== 'undefined') Logger.error('Weather reports load failed', err && err.message ? err.message : err);
      renderStatus(`Failed to load reports: ${err.message || err}`);
    }
  }

  async function refreshAll() {
    try {
      await Promise.all([loadReports(), loadHistory(168)]);
      ensureChart();
      redrawChart();
      renderCurrentStatus();
      if (!historyRows.length) {
        renderStatus('No weather history yet. Wait ~30s for backend to store rows.');
      }
    } catch (err) {
      renderStatus(`Chart load failed: ${err && err.message ? err.message : err}`);
    }
  }

  function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    Sidebar.render();
    renderStatus('Loading reports...');
    loadWeatherConfig();
    renderConfigSection();
    const toggleTitle = document.getElementById('weatherChartToggleTitle');
    const chartBody = document.getElementById('weatherChartBody');
    const toggle = () => {
      chartCollapsed = !chartCollapsed;
      chartBody.classList.toggle('collapsed', chartCollapsed);
      if (toggleTitle) {
        toggleTitle.setAttribute('aria-expanded', String(!chartCollapsed));
      }
    };
    if (toggleTitle && chartBody) {
      toggleTitle.addEventListener('click', () => {
        toggle();
      });
      toggleTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    } else if (chartBody) {
      // keep safe fallback in case title element changes
      chartBody.classList.toggle('collapsed', chartCollapsed);
    }

    const rangeSel = document.getElementById('weatherRangeSel');
    if (rangeSel) {
      rangeSel.addEventListener('click', (e) => {
        const btn = e.target.closest('.ts-btn');
        if (!btn) return;
        rangeSel.querySelectorAll('.ts-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedRange = Number(btn.dataset.range || 6);
        redrawChart();
      });
    }

    const quickList = document.getElementById('quickAnalysisList');
    if (quickList) {
      quickList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-qa-metric]');
        if (!row || selectedMetric !== 'all') return;
        const metric = row.dataset.qaMetric;
        if (activeMetrics.has(metric)) {
          if (activeMetrics.size === 1) return;
          activeMetrics.delete(metric);
        } else {
          activeMetrics.add(metric);
        }
        if (typeof Logger !== 'undefined') Logger.action('Quick analysis metric toggled', { metric, enabled: activeMetrics.has(metric) });
        redrawChart();
      });
    }

    const qaToggleAllLabel = document.getElementById('qaToggleAllLabel');
    const toggleAll = () => {
      if (selectedMetric !== 'all') return;
      const metrics = Object.keys(METRIC_META);
      const allSelected = metrics.every((m) => activeMetrics.has(m));
      if (allSelected) {
        activeMetrics = new Set();
      } else {
        activeMetrics = new Set(metrics);
      }
      redrawChart();
    };
    if (qaToggleAllLabel) {
      qaToggleAllLabel.addEventListener('click', () => {
        if (typeof Logger !== 'undefined') Logger.action('Quick analysis toggle all clicked');
        toggleAll();
      });
      qaToggleAllLabel.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleAll();
      });
    }

    const cfgRoot = document.getElementById('weatherConfigRoot');
    if (cfgRoot) {
      cfgRoot.addEventListener('change', (e) => {
        const t = e.target;
        if (!t || !t.dataset || !t.dataset.cfg) return;
        const key = t.dataset.cfg;
        weatherConfig[key] = t.tagName === 'SELECT' ? t.value : Number(t.value);
      });
      const applyBtn = document.getElementById('weatherCfgApply');
      if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
          saveWeatherConfig();
          if (typeof Logger !== 'undefined') Logger.action('Weather configuration applied', weatherConfig);
          await refreshAll();
        });
      }
      const resetBtn = document.getElementById('weatherCfgReset');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          weatherConfig = { ...DEFAULT_CONFIG };
          saveWeatherConfig();
          renderConfigSection();
          if (typeof Logger !== 'undefined') Logger.action('Weather configuration reset to defaults');
          await refreshAll();
        });
      }
    }

    const reportArea = document.querySelector('.weather-page-wrap');
    if (reportArea) {
      reportArea.addEventListener('click', (e) => {
        const t = e.target.closest('[data-report-toggle]');
        if (!t) return;
        const id = t.dataset.reportToggle;
        const body = document.getElementById(`reportBody-${id}`);
        if (!body) return;
        body.classList.toggle('collapsed');
        t.setAttribute('aria-expanded', String(!body.classList.contains('collapsed')));
        if (typeof Logger !== 'undefined') Logger.action('Weather report section toggled', { section: id, expanded: !body.classList.contains('collapsed') });
      });
      reportArea.addEventListener('keydown', (e) => {
        const t = e.target.closest('[data-report-toggle]');
        if (!t) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const id = t.dataset.reportToggle;
        const body = document.getElementById(`reportBody-${id}`);
        if (!body) return;
        body.classList.toggle('collapsed');
        t.setAttribute('aria-expanded', String(!body.classList.contains('collapsed')));
      });
    }
    refreshAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { loadReports };
})();
