const PrecisionGrowingPage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const HISTORY_MAX = 24 * 12;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const series = [];
  let timer = null;
  const visibleSeries = {
    drainage: true,
    plantWeight: true,
    slabMoisture: true,
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function nextPoint(prev, climate, incoming) {
    const t = Number.isFinite(Number(climate && climate.temp)) ? Number(climate.temp) : 22;
    const h = Number.isFinite(Number(climate && climate.humidity)) ? Number(climate.humidity) : 70;
    const inDrain = Number(incoming && incoming.drainageVolume);
    const inWeight = Number(incoming && incoming.plantWeight);
    const inSlab = Number(incoming && incoming.slabMoisture);
    if (!prev) {
      return {
        drainage: Number.isFinite(inDrain) ? inDrain : clamp(5 + (h - 55) * 0.18, 2, 35),
        plantWeight: Number.isFinite(inWeight) ? inWeight : clamp(1200 + (t - 20) * 22, 700, 4500),
        slabMoisture: Number.isFinite(inSlab) ? inSlab : clamp(h + (Math.random() - 0.5) * 6, 35, 95),
      };
    }
    return {
      drainage: Number.isFinite(inDrain)
        ? inDrain
        : clamp(prev.drainage + (Math.random() - 0.5) * 2.6 + (h - 65) * 0.04, 1.5, 40),
      plantWeight: Number.isFinite(inWeight)
        ? inWeight
        : clamp(prev.plantWeight + (Math.random() - 0.45) * 22 + (t - 20) * 0.7, 650, 5200),
      slabMoisture: Number.isFinite(inSlab)
        ? inSlab
        : clamp(prev.slabMoisture + (Math.random() - 0.5) * 2.8 + (h - 70) * 0.06, 30, 98),
    };
  }

  function pushPoint(p) {
    const now = Date.now();
    series.push({
      t: now,
      drainage: p.drainage,
      plantWeight: p.plantWeight,
      slabMoisture: p.slabMoisture,
    });
    const cutoff = now - 24 * 60 * 60 * 1000;
    while (series.length && series[0].t < cutoff) series.shift();
    if (series.length > HISTORY_MAX) series.splice(0, series.length - HISTORY_MAX);
  }

  function seedHistory(climate, incoming) {
    if (series.length >= 12) return;
    const baseClimate = climate || { temp: 22, humidity: 70 };
    let prev = null;
    const startTs = Date.now() - (HISTORY_MAX - 1) * 5 * 60 * 1000;
    for (let i = 0; i < HISTORY_MAX; i += 1) {
      const point = nextPoint(prev, baseClimate, incoming);
      // Make simulated history visually informative from first load.
      const wave = Math.sin((i / HISTORY_MAX) * Math.PI * 3);
      point.plantWeight = clamp(point.plantWeight + wave * 70, 650, 5200);
      point.slabMoisture = clamp(point.slabMoisture + wave * 4, 30, 98);
      prev = point;
      series.push({
        t: startTs + i * 5 * 60 * 1000,
        drainage: prev.drainage,
        plantWeight: prev.plantWeight,
        slabMoisture: prev.slabMoisture,
      });
    }
  }

  function toNorm(v, min, max) {
    if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
    return (v - min) / (max - min);
  }

  function toScale1to10(v, min, max) {
    return 1 + 9 * toNorm(v, min, max);
  }

  function drawLine(ctx, area, points, key, min, max, color) {
    if (!points.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const d = new Date(Number(points[i].t));
      const minuteOfDay = d.getHours() * 60 + d.getMinutes();
      const x = area.x + (minuteOfDay / (24 * 60)) * area.w;
      const scaled = toScale1to10(points[i][key], min, max);
      const y = area.y + area.h * (1 - toNorm(scaled, 1, 10));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawChart() {
    const canvas = document.getElementById('pgChartCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const parentStyles = parent ? window.getComputedStyle(parent) : null;
    const padLeft = parentStyles ? parseFloat(parentStyles.paddingLeft || '0') : 0;
    const padRight = parentStyles ? parseFloat(parentStyles.paddingRight || '0') : 0;
    const innerW = (parent && parent.clientWidth) ? parent.clientWidth - padLeft - padRight : 700;
    const cssW = Math.max(420, Math.floor(innerW));
    const cssH = 440;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const area = { x: 46, y: 14, w: cssW - 62, h: cssH - 48 };
    ctx.strokeStyle = '#e2eaf0';
    ctx.lineWidth = 1;
    for (let level = 1; level <= 10; level += 1) {
      const y = area.y + area.h * (1 - toNorm(level, 1, 10));
      ctx.beginPath();
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
      ctx.stroke();
      if (level === 1 || level % 2 === 0 || level === 10) {
        ctx.fillStyle = '#7c8f9b';
        ctx.font = '11px "DM Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(level), area.x - 10, y);
      }
    }

    for (let h = 0; h <= 24; h += 4) {
      const x = area.x + (h / 24) * area.w;
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.strokeStyle = '#edf2f5';
      ctx.stroke();
      ctx.fillStyle = '#7c8f9b';
      ctx.font = '11px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${String(h).padStart(2, '0')}:00`, x, area.y + area.h + 8);
    }

    if (visibleSeries.drainage) drawLine(ctx, area, series, 'drainage', 0, 40, '#1f78b4');
    if (visibleSeries.plantWeight) drawLine(ctx, area, series, 'plantWeight', 600, 5200, '#2e9e5b');
    if (visibleSeries.slabMoisture) drawLine(ctx, area, series, 'slabMoisture', 30, 100, '#d96f17');
  }

  function setMetric(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text == null || text === '' ? '—' : String(text);
  }

  function updateLiveMetrics(sensors) {
    const pg = sensors && sensors.precisionGrowing ? sensors.precisionGrowing : null;
    const room = sensors && sensors.aranetRoom ? sensors.aranetRoom : null;
    const mq = sensors && sensors.mqtt ? sensors.mqtt : null;
    const climate = sensors && sensors.climate ? sensors.climate : {};

    const leaf = pg && pg.leafTemp != null ? Number(pg.leafTemp) : NaN;
    setMetric('pgMetLeaf', Number.isFinite(leaf) ? `${leaf.toFixed(1)} °C` : '—');

    let vpdText = '—';
    const vpd = pg && pg.vpd != null ? Number(pg.vpd) : NaN;
    if (Number.isFinite(vpd)) {
      vpdText = `${vpd.toFixed(2)} kPa`;
    } else if (Number.isFinite(leaf)) {
      const rh = room && room.humidity != null ? Number(room.humidity) : Number(climate.humidity);
      if (Number.isFinite(rh) && rh >= 0 && rh <= 100) {
        const svp = 0.6108 * Math.exp((17.27 * leaf) / (leaf + 237.3));
        vpdText = `${(svp * (1 - rh / 100)).toFixed(2)} kPa`;
      }
    }
    setMetric('pgMetVpd', vpdText);

    const par = pg && pg.par != null ? Number(pg.par) : NaN;
    setMetric('pgMetPar', Number.isFinite(par) ? String(Math.round(par)) : '—');

    const ec = pg && pg.slabEc != null ? Number(pg.slabEc) : NaN;
    setMetric('pgMetSlabEc', Number.isFinite(ec) ? ec.toFixed(2) : '—');

    const pScale = pg && pg.plantScale != null ? Number(pg.plantScale) : NaN;
    setMetric('pgMetPlantScale', Number.isFinite(pScale) ? pScale.toFixed(1) : '—');

    const sScale = pg && pg.slabScale != null ? Number(pg.slabScale) : NaN;
    setMetric('pgMetSlabScale', Number.isFinite(sScale) ? sScale.toFixed(1) : '—');

    const air = room && room.temp != null ? Number(room.temp) : NaN;
    setMetric('pgMetAir', Number.isFinite(air) ? `${air.toFixed(1)} °C` : '—');

    const rhR = room && room.humidity != null ? Number(room.humidity) : NaN;
    setMetric('pgMetRh', Number.isFinite(rhR) ? `${Math.round(rhR)} %` : '—');

    let mqttText = '—';
    if (mq && typeof mq.connected === 'boolean') {
      if (mq.connected && mq.updatedAt) {
        const t = new Date(mq.updatedAt);
        mqttText = Number.isFinite(t.getTime()) ? `Live · ${t.toLocaleTimeString()}` : 'Live';
      } else {
        mqttText = mq.connected ? 'Live' : 'Offline';
      }
    }
    setMetric('pgMetMqtt', mqttText);
    updateMqttRaw(sensors);
  }

  function updateMqttRaw(sensors) {
    const wrap = document.getElementById('pgMqttRaw');
    if (!wrap) return;
    const mq = sensors && sensors.mqtt ? sensors.mqtt : null;
    const arr = mq && Array.isArray(mq.recentMessages) ? mq.recentMessages : [];
    wrap.textContent = '';
    if (!arr.length) {
      wrap.textContent =
        'No MQTT messages captured yet. When Aranet publishes under your subscribe topic, each message appears here.';
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      const m = arr[i];
      const row = document.createElement('div');
      row.className = 'pg-mqtt-raw-row';
      const meta = document.createElement('div');
      meta.className = 'pg-mqtt-raw-meta';
      meta.textContent = `${m.at || ''} · ${m.topic || ''}`;
      const pre = document.createElement('pre');
      pre.className = 'pg-mqtt-raw-payload';
      pre.textContent = m.payload != null ? String(m.payload) : '';
      row.appendChild(meta);
      row.appendChild(pre);
      frag.appendChild(row);
    }
    wrap.appendChild(frag);
  }

  function localDayRangeForDate(d) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const start = new Date(y, m, day, 0, 0, 0, 0);
    const end = new Date(y, m, day + 1, 0, 0, 0, 0);
    return { start: start.getTime(), end: end.getTime() };
  }

  function formatDrainageDayStamp(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
  }

  function formatDrainageMl(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0.000';
    return x.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function buildDrainagePanelEl(data, which, title, subtitle, dateObj, dayLabel, asOfLine) {
    const block = data && data[which] ? data[which] : null;
    const hourly = block && Array.isArray(block.hourlyMl) ? block.hourlyMl : new Array(24).fill(0);
    const total = block && Number.isFinite(Number(block.totalMl)) ? Number(block.totalMl) : 0;
    const max = Math.max(1e-9, ...hourly.map((v) => Number(v) || 0));

    const panel = document.createElement('div');
    panel.className = 'pg-drain-panel';

    const head = document.createElement('div');
    head.className = 'pg-drain-panel-head';
    const left = document.createElement('div');
    const tEl = document.createElement('div');
    tEl.className = 'pg-drain-title';
    tEl.textContent = title;
    left.appendChild(tEl);
    if (subtitle) {
      const sEl = document.createElement('div');
      sEl.className = 'pg-drain-sub';
      sEl.textContent = subtitle;
      left.appendChild(sEl);
    }
    const badge = document.createElement('span');
    badge.className = 'pg-drain-day-badge';
    badge.textContent = dayLabel;
    head.appendChild(left);
    head.appendChild(badge);
    panel.appendChild(head);

    const dateLine = document.createElement('div');
    dateLine.className = 'pg-drain-date';
    dateLine.textContent = `${formatDrainageDayStamp(dateObj)}${asOfLine || ''}`;
    panel.appendChild(dateLine);

    const totalEl = document.createElement('div');
    totalEl.className = 'pg-drain-total';
    totalEl.appendChild(document.createTextNode(`${formatDrainageMl(total)} `));
    const unit = document.createElement('span');
    unit.className = 'pg-drain-unit';
    unit.textContent = 'ml';
    totalEl.appendChild(unit);
    panel.appendChild(totalEl);

    const chart = document.createElement('div');
    chart.className = 'pg-drain-chart';
    const grid = document.createElement('div');
    grid.className = 'pg-drain-chart-grid';
    for (let h = 0; h < 24; h += 1) {
      const cell = document.createElement('div');
      cell.className = 'pg-drain-bar-cell';
      const bar = document.createElement('div');
      bar.className = 'pg-drain-bar';
      const v = Number(hourly[h]) || 0;
      const pct = Math.round((v / max) * 100);
      bar.style.height = `${pct}%`;
      bar.title = `${String(h).padStart(2, '0')}:00 — ${v.toFixed(1)} ml`;
      cell.appendChild(bar);
      grid.appendChild(cell);
    }
    chart.appendChild(grid);

    const xaxis = document.createElement('div');
    xaxis.className = 'pg-drain-xaxis';
    for (let h = 0; h < 24; h += 1) {
      const lab = document.createElement('span');
      lab.className = 'pg-drain-xlabel' + (h % 4 === 0 ? ' pg-drain-xlabel--tick' : '');
      lab.textContent = h % 4 === 0 ? String(h).padStart(2, '0') : '·';
      xaxis.appendChild(lab);
    }
    chart.appendChild(xaxis);
    panel.appendChild(chart);

    return panel;
  }

  async function refreshDrainage() {
    const wrap = document.getElementById('pgDrainagePanels');
    const errEl = document.getElementById('pgDrainageError');
    if (!wrap || !errEl) return;
    const now = new Date();
    const yDate = new Date(now);
    yDate.setDate(yDate.getDate() - 1);
    const ry = localDayRangeForDate(yDate);
    const rt = localDayRangeForDate(now);
    try {
      const data = await SensorAPI.fetchDrainageDaily(ry.start, ry.end, rt.start, rt.end);
      if (!data || !data.ok) {
        errEl.hidden = false;
        errEl.textContent = (data && data.message) || 'Drainage history is unavailable.';
        wrap.textContent = '';
        return;
      }
      errEl.hidden = true;
      wrap.textContent = '';
      const title = data.title || 'Drainage sensor';
      const sub = data.subtitle || '';
      const asOfToday = ` (as of ${Helpers.timeStr(now)})`;
      wrap.appendChild(buildDrainagePanelEl(data, 'yesterday', title, sub, yDate, 'Yesterday', ''));
      wrap.appendChild(buildDrainagePanelEl(data, 'today', title, sub, now, 'Today', asOfToday));
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = e && e.message ? String(e.message) : 'Could not load drainage.';
      wrap.textContent = '';
    }
  }

  function setStatusBar(state) {
    const bar = document.getElementById('pgStatusBar');
    if (!bar) return;
    const dotCls = { online: 'online', offline: 'offline', loading: 'loading' }[state] || 'loading';
    const label = { online: 'Connected', offline: 'Offline', loading: 'Loading…' }[state] || '';
    bar.innerHTML = `
      <div class="status-item">
        <div class="status-dot ${dotCls}"></div>
        <span>${label}</span>
      </div>
      <div class="status-item">Precision Growing metrics</div>
    `;
  }

  async function refresh() {
    setStatusBar('loading');
    try {
      const { current } = await WeatherAPI.fetch();
      const sensors = await SensorAPI.fetchAll(current || {});
      seedHistory(sensors && sensors.climate ? sensors.climate : {}, sensors && sensors.precisionGrowing ? sensors.precisionGrowing : null);
      const prev = series.length ? series[series.length - 1] : null;
      pushPoint(nextPoint(prev, sensors && sensors.climate ? sensors.climate : {}, sensors && sensors.precisionGrowing ? sensors.precisionGrowing : null));
      drawChart();
      updateLiveMetrics(sensors || {});
      await refreshDrainage();
      setStatusBar('online');
      const last = document.getElementById('pgLastUpdated');
      if (last) last.textContent = Helpers.timeStr();
    } catch (_err) {
      setStatusBar('offline');
      updateLiveMetrics({});
      await refreshDrainage();
    }
  }

  function renderActions() {
    const bar = document.getElementById('pgActionsBar');
    if (!bar) return;
    bar.innerHTML = `
      <button class="btn btn-primary" id="pgRefreshBtn" type="button">
        <span>${Helpers.ICONS.refresh}</span>
        Refresh
      </button>
      <a class="btn btn-secondary" href="index.html">Back to dashboard</a>
    `;
    const btn = document.getElementById('pgRefreshBtn');
    if (btn) btn.addEventListener('click', () => refresh());
  }

  function setupGrafanaEmbed() {
    const base = CONFIG.grafanaEmbedBaseUrl != null ? String(CONFIG.grafanaEmbedBaseUrl).trim() : '';
    const uid = CONFIG.grafanaDashboardUid != null ? String(CONFIG.grafanaDashboardUid).trim() : 'greenhouse-overview';
    const section = document.getElementById('data-driven-growing-anchor');
    const frame = document.getElementById('pgGrafanaEmbedFrame');
    const ext = document.getElementById('pgGrafanaOpenExternal');
    if (!section || !frame || !ext) return;
    if (!base) return;
    const root = base.replace(/\/$/, '');
    const from = encodeURIComponent('now-7d');
    const to = encodeURIComponent('now');
    const src = `${root}/d/${uid}/embedded?orgId=1&kiosk=tv&theme=light&from=${from}&to=${to}`;
    const tab = `${root}/d/${uid}/embedded?orgId=1&kiosk&theme=light&from=${from}&to=${to}`;
    frame.src = src;
    ext.href = tab;
    section.removeAttribute('hidden');
  }

  function bindFilterPanel() {
    const panel = document.getElementById('pgFilterPanel');
    if (!panel) return;
    const title = panel.querySelector('.precision-growing-filter-title');
    if (title) {
      title.addEventListener('click', () => {
        const keys = Object.keys(visibleSeries);
        const allOn = keys.every((k) => Boolean(visibleSeries[k]));
        const next = !allOn;
        keys.forEach((k) => { visibleSeries[k] = next; });
        const checks = panel.querySelectorAll('input[data-series-key]');
        for (let i = 0; i < checks.length; i += 1) {
          checks[i].checked = next;
        }
        drawChart();
      });
    }
    panel.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-series-key]');
      if (!input || !panel.contains(input)) return;
      const key = String(input.getAttribute('data-series-key') || '');
      if (!Object.prototype.hasOwnProperty.call(visibleSeries, key)) return;
      visibleSeries[key] = Boolean(input.checked);
      drawChart();
    });
  }

  function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    Sidebar.render();
    renderActions();
    bindFilterPanel();
    setupGrafanaEmbed();
    refresh();
    timer = window.setInterval(refresh, CONFIG.pollIntervalMs || 30000);
    window.addEventListener('resize', drawChart);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { refresh };
})();
