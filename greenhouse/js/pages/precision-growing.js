const PrecisionGrowingPage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const HISTORY_MAX = 24 * 12;
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
      setStatusBar('online');
      const last = document.getElementById('pgLastUpdated');
      if (last) last.textContent = Helpers.timeStr();
    } catch (_err) {
      setStatusBar('offline');
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
