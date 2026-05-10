const ClimatePage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const tileMeta = [];
  const SECTION_SLUGS = {
    'Climate strategy': 'climate-strategy',
    Temperature: 'temperature',
    Humidity: 'humidity',
    'Mixing valves': 'mixing-valves',
    'Cooling stages': 'cooling-stages',
    Ventilation: 'ventilation',
    'Air circulation': 'air-circulation',
    Curtain: 'curtain',
    Customization: 'customization',
    'Crop treatment': 'crop-treatment',
  };

  const VENTILATION_STATUS_STORAGE_KEY = 'ventilationStatus.v1';
  let climateVentBarInterval = null;

  function readClimateVentFromStorage() {
    try {
      const raw = window.localStorage.getItem(VENTILATION_STATUS_STORAGE_KEY);
      if (!raw) {
        return { actual: 0, calculated: 0, orientation: 'wind' };
      }
      const o = JSON.parse(raw);
      const v0 = o && o.vents && o.vents[0] ? o.vents[0] : {};
      const actual = Number(v0.actualVentPositionPct);
      const calculated = Number(v0.calculatedVentPositionPct);
      const orientRaw = typeof v0.ventOrientation === 'string' ? v0.ventOrientation.trim() : '';
      return {
        actual: Number.isFinite(actual) ? actual : 0,
        calculated: Number.isFinite(calculated) ? calculated : 0,
        orientation: orientRaw || 'wind',
      };
    } catch (_e) {
      return { actual: 0, calculated: 0, orientation: 'wind' };
    }
  }

  function formatVentOrientCardLabel(orient) {
    const s = String(orient || '').trim();
    if (!s) return '—';
    const lower = s.toLowerCase();
    if (lower.includes('lee')) return 'Lee';
    if (lower.includes('wind')) return 'Wind';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function climateVentPrivaAsideHtml() {
    const v = readClimateVentFromStorage();
    const pct = Math.max(0, Math.min(100, v.actual));
    const display = Math.round(pct * 10) / 10;
    return (
      '<div class="climate-vent-priva" aria-label="Actual vent position">' +
      '<div class="climate-vent-priva-value" id="climateVentBarValue">' +
      display +
      '</div>' +
      '<div class="climate-vent-priva-track">' +
      '<div class="climate-vent-priva-fill" id="climateVentBarFill" style="height:' +
      pct +
      '%"></div>' +
      '</div>' +
      '<div class="climate-vent-priva-caption"><span>Vent position</span></div>' +
      '</div>'
    );
  }

  function updateClimateVentBarFromStorage() {
    const v = readClimateVentFromStorage();
    const pct = Math.max(0, Math.min(100, v.actual));
    const display = Math.round(pct * 10) / 10;
    const orient = formatVentOrientCardLabel(v.orientation);
    const calcDisp = Math.round(v.calculated * 10) / 10;
    const fill = document.getElementById('climateVentBarFill');
    const valEl = document.getElementById('climateVentBarValue');
    const kva = document.getElementById('climateVentKvActual');
    const kvc = document.getElementById('climateVentKvCalc');
    const kvo = document.getElementById('climateVentKvOrient');
    if (fill) fill.style.height = `${pct}%`;
    if (valEl) valEl.textContent = String(display);
    if (kva) kva.textContent = `${display.toFixed(1)}%`;
    if (kvc) kvc.textContent = `${calcDisp.toFixed(1)}%`;
    if (kvo) kvo.textContent = orient;
  }

  function stopClimateVentBarPoll() {
    if (climateVentBarInterval) {
      window.clearInterval(climateVentBarInterval);
      climateVentBarInterval = null;
    }
  }

  function startClimateVentBarPoll() {
    stopClimateVentBarPoll();
    updateClimateVentBarFromStorage();
    climateVentBarInterval = window.setInterval(updateClimateVentBarFromStorage, 1000);
  }

  function parseStartMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function parseRampMinutes(raw) {
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

  function currentPeriodFromPeriods(periods) {
    if (!Array.isArray(periods)) return '-';
    const sched = [];
    let no = 0;
    periods.forEach((p) => {
      if (!p || !p.use || !p.startTime) return;
      const startMin = parseStartMinutes(p.startTime);
      if (startMin == null) return;
      no += 1;
      sched.push({ no, startMin, rampMin: parseRampMinutes(p.rampTime) });
    });
    if (!sched.length) return '-';
    sched.sort((a, b) => a.startMin - b.startMin);
    if (sched.length === 1) return 'P1';
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let idx = sched.length - 1;
    for (let i = 0; i < sched.length; i += 1) {
      if (sched[i].startMin <= minute) idx = i;
      else break;
    }
    const curr = sched[idx];
    const prev = sched[(idx - 1 + sched.length) % sched.length];
    let since = minute - curr.startMin;
    if (since < 0) since += 24 * 60;
    if (Number.isFinite(curr.rampMin) && curr.rampMin > 0 && since < curr.rampMin) {
      return `P${prev.no} -> P${curr.no}`;
    }
    return `P${curr.no}`;
  }

  async function fetchCurrentPeriodLabel() {
    try {
      const token = window.localStorage.getItem(TOKEN_KEY) || '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
      const res = await window.fetch(`${base}/api/climate-strategy/periods`, { headers, cache: 'no-store' });
      if (!res.ok) return '-';
      const body = await res.json();
      return currentPeriodFromPeriods(body && body.periods);
    } catch (_err) {
      return '-';
    }
  }

  function tile(title, valueHtml, rows, gauge) {
    const id = `climateTile-${tileMeta.length}`;
    tileMeta.push({ id, title, rows, slug: SECTION_SLUGS[title] || 'climate-strategy' });
    const rowsHtml = Array.isArray(rows) ? rows.map((r) => `<div>${r}</div>`).join('') : '';
    const centeredPanelClass = !gauge && !rowsHtml ? ' climate-box--centered-panel' : '';
    const strategyCardClass = title === 'Climate strategy' ? ' climate-box--strategy-card' : '';
    const aside =
      gauge && typeof gauge.asideHtml === 'string' && gauge.asideHtml.trim() ? gauge.asideHtml : '';
    const asideOnly = Boolean(gauge && gauge.asideOnly === true && aside);
    const ventCardClass = asideOnly ? ' climate-box--vent-card' : '';
    const gaugeHtml =
      gauge && !asideOnly
        ? Gauge.html({
          id: gauge.id,
          min: gauge.min,
          max: gauge.max,
          unit: gauge.unit,
          color: gauge.color || 'green',
        })
        : '';
    let visual;
    if (asideOnly) {
      visual = `<div class="climate-gauge-visual climate-gauge-visual--vent-only">${aside}</div>`;
    } else if (gauge) {
      visual = aside
        ? `<div class="climate-gauge-visual climate-gauge-visual--with-aside"><div class="climate-gauge-wrap climate-gauge-wrap--inline">${gaugeHtml}</div>${aside}</div>`
        : `<div class="climate-gauge-wrap">${gaugeHtml}</div>`;
    } else {
      visual = `<div class="climate-value-panel">${valueHtml}</div>`;
    }
    return `
      <section class="climate-box clickable${ventCardClass}${centeredPanelClass}${strategyCardClass}" id="${id}" role="button" tabindex="0" title="Open ${title} page">
        <div class="climate-title">${title}</div>
        ${visual}
        ${rowsHtml ? `<div class="climate-kv">${rowsHtml}</div>` : ''}
      </section>
    `;
  }

  function formatPeriodLabelForCard(shortLabel) {
    const s = String(shortLabel || '-').trim();
    if (!s || s === '-') return 'Period -';
    const transition = /^P(\d+)\s*->\s*P(\d+)$/i.exec(s);
    if (transition) return `Period P${transition[1]}-P${transition[2]}`;
    const single = /^P(\d+)$/i.exec(s);
    if (single) return `Period P${single[1]}`;
    return `Period ${s}`;
  }

  function renderStatusBar(source, indoorProbeName) {
    const bar = document.getElementById('climateStatusBar');
    if (!bar) return;
    const probeLine = indoorProbeName
      ? `<div class="status-item">Indoor probe: <span class="font-mono font-semibold">${indoorProbeName}</span></div>`
      : '';
    bar.innerHTML = `
      <div class="status-item"><div class="status-dot online"></div><span>Climate page live</span></div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
      <div class="status-item">Weather source: <span class="font-mono font-semibold">${source}</span></div>
      ${probeLine}
    `;
  }

  async function render() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    stopClimateVentBarPoll();
    tileMeta.length = 0;
    let weather = {};
    let sensors = {};
    try {
      const data = await WeatherAPI.fetch();
      weather = data.current || {};
      sensors = await SensorAPI.fetchAll(weather);
      renderStatusBar(
        weather.source || 'local-db',
        sensors.climate && sensors.climate.indoorProbeName ? sensors.climate.indoorProbeName : null
      );
    } catch (err) {
      renderStatusBar('unavailable', null);
    }

    const outdoorTemp = Number.isFinite(Number(weather.temperature_2m))
      ? Number(weather.temperature_2m)
      : 0;
    const outdoorRh = weather.relative_humidity_2m ?? 0;
    const rhFromClimate =
      sensors.climate && sensors.climate.humidity != null
        ? Number(sensors.climate.humidity)
        : null;
    const humidity =
      rhFromClimate != null && Number.isFinite(rhFromClimate) ? rhFromClimate : outdoorRh;
    const wind = weather.wind_speed_10m ?? 0;
    const rawIndoorT =
      sensors.climate && sensors.climate.temp != null ? sensors.climate.temp : outdoorTemp;
    let climateTemp = Number(rawIndoorT);
    if (!Number.isFinite(climateTemp)) climateTemp = outdoorTemp;
    const [cMin, cMax] = CONFIG.gaugeRanges.climate;
    const [hMin, hMax] = CONFIG.gaugeRanges.humidity;
    const [pctMin, pctMax] = CONFIG.gaugeRanges.percent;
    const humidityGauge = Number.isFinite(Number(humidity)) ? Number(humidity) : 0;
    const probeHint =
      sensors.climate && sensors.climate.indoorProbeName
        ? `Sensor: <b>${sensors.climate.indoorProbeName}</b>`
        : null;

    const currentPeriodLabel = await fetchCurrentPeriodLabel();
    const cardPeriodLabel = formatPeriodLabelForCard(currentPeriodLabel);
    const ventSnap = readClimateVentFromStorage();
    const html = [
      tile('Climate strategy', `<span>${cardPeriodLabel}</span>`, []),
      tile('Temperature', `${climateTemp}<span class="climate-unit">°C</span>`, [
        probeHint || `Outdoor air: <b>${outdoorTemp} °C</b>`,
        `Calculated heating temperature: <b>${(climateTemp - 1).toFixed(1)} °C</b>`,
        `Calculated cooling temperature: <b>${(climateTemp + 1).toFixed(1)} °C</b>`,
      ], { id: 'clGaugeTemp', min: cMin, max: cMax, unit: '°C', color: 'green' }),
      tile('Humidity', `${humidity}<span class="climate-unit">%</span>`, [
        probeHint || `Outdoor station RH: <b>${outdoorRh}%</b>`,
        `Measured absolute humidity: <b>${(humidity * 0.12).toFixed(1)} g/m³</b>`,
        `Measured humidity deficit: <b>${Math.max(0, (100 - humidity) * 0.06).toFixed(1)} g/m³</b>`,
      ], { id: 'clGaugeHumidity', min: hMin, max: hMax, unit: '%', color: 'green' }),
      tile('Mixing valves', `${Math.round((outdoorTemp / 40) * 100)}<span class="climate-unit">%</span>`, [
        'Mixing valve status: <b>No limits</b>',
        `Maximum temperature: <b>${Math.max(0, outdoorTemp + 10).toFixed(1)} °C</b>`,
      ], { id: 'clGaugeMix', min: pctMin, max: pctMax, unit: '%', color: 'green' }),
      tile('Cooling stages', `0<span class="climate-unit">%</span>`, [
        'Cooling status',
        '<b>No cooling</b>',
      ], { id: 'clGaugeCooling', min: pctMin, max: pctMax, unit: '%', color: 'blue' }),
      tile('Ventilation', '', [
        `Wind: <b>${Math.round(wind)} m/s</b>`,
        `Calculated vent: <b id="climateVentKvCalc">${(Math.round(ventSnap.calculated * 10) / 10).toFixed(1)}%</b> · Actual: <b id="climateVentKvActual">${(Math.round(ventSnap.actual * 10) / 10).toFixed(1)}%</b>`,
        `Vent 1 — <span>Orientation</span> <b id="climateVentKvOrient">${formatVentOrientCardLabel(ventSnap.orientation)}</b>`,
      ], { asideOnly: true, asideHtml: climateVentPrivaAsideHtml() }),
      tile('Air circulation', `100<span class="climate-unit">%</span>`, [
        'Status',
        '<b>Humidity control</b>',
      ], { id: 'clGaugeAir', min: pctMin, max: pctMax, unit: '%', color: 'blue' }),
      tile('Curtain', `100<span class="climate-unit">%</span>`, [
        'Curtain status',
        '<b>Night</b>',
      ], { id: 'clGaugeCurtain', min: pctMin, max: pctMax, unit: '%', color: 'blue' }),
      tile('Customization', `<span>—</span>`, [
        'Custom setpoint: <b>Off</b>',
        'Override: <b>—</b>',
      ]),
      tile('Crop treatment', `<span>Off</span>`, [
        'Treatment status',
        '<b>Off</b>',
      ]),
    ].join('');

    document.getElementById('climateGrid').innerHTML = html;

    Gauge.update('clGaugeTemp', climateTemp, cMin, cMax, `${climateTemp}°C`);
    Gauge.update('clGaugeHumidity', humidityGauge, hMin, hMax, `${Math.round(humidityGauge)}%`);
    Gauge.update(
      'clGaugeMix',
      Math.round((outdoorTemp / 40) * 100),
      pctMin,
      pctMax,
      `${Math.round((outdoorTemp / 40) * 100)}%`
    );
    Gauge.update('clGaugeCooling', 0, pctMin, pctMax, '0%');
    startClimateVentBarPoll();
    Gauge.update('clGaugeAir', 100, pctMin, pctMax, '100%');
    Gauge.update('clGaugeCurtain', 100, pctMin, pctMax, '100%');

    tileMeta.forEach((m) => {
      const el = document.getElementById(m.id);
      if (!el) return;
      const open = () => { window.location.href = `climate-${m.slug}.html`; };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  if (!window.__climateVentBarListeners) {
    window.__climateVentBarListeners = true;
    window.addEventListener('storage', (e) => {
      if (e.key === VENTILATION_STATUS_STORAGE_KEY) updateClimateVentBarFromStorage();
    });
    window.addEventListener('ventilationStatusUpdated', updateClimateVentBarFromStorage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  return { render };
})();
