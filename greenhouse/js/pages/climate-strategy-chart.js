(function () {
  var chart = null;
  var hostEl = null;
  var canvasEl = null;

  function parseStartMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    var h = Number(m[1]);
    var mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function parseRampMinutes(raw) {
    if (raw == null || raw === '') return 0;
    var s = String(raw).trim().replace(',', '.');
    var n = Number(s);
    if (Number.isFinite(n)) return Math.max(0, n * 60);
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (!m) return 0;
    return Math.max(0, Number(m[1]) * 60 + Number(m[2]));
  }

  function buildPeriodSchedule() {
    if (typeof window.ClimateStrategyPeriods === 'undefined' || typeof window.ClimateStrategyPeriods.getState !== 'function') {
      return [];
    }
    var periods = [];
    try {
      periods = window.ClimateStrategyPeriods.getState();
    } catch (_e) {
      return [];
    }
    if (!Array.isArray(periods)) return [];
    var out = [];
    var no = 0;
    periods.forEach(function (p) {
      if (!p || !p.use || !p.startTime) return;
      var startMin = parseStartMinutes(p.startTime);
      if (startMin == null) return;
      no += 1;
      out.push({
        periodNo: no,
        startMin: startMin,
        rampMin: parseRampMinutes(p.rampTime),
        cooling: Number(String((p.details && p.details.coolingTemp) || '').replace(',', '.')),
        heating: Number(String((p.details && p.details.heatingTemp) || '').replace(',', '.')),
      });
    });
    out.sort(function (a, b) { return a.startMin - b.startMin; });
    return out;
  }

  function valueAtTime(tsMs, schedule, key) {
    if (!Number.isFinite(tsMs) || !schedule.length) return null;
    if (schedule.length === 1) return Number.isFinite(schedule[0][key]) ? schedule[0][key] : null;
    var d = new Date(tsMs);
    var minute = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    var idx = schedule.length - 1;
    for (var i = 0; i < schedule.length; i += 1) {
      if (schedule[i].startMin <= minute) idx = i;
      else break;
    }
    var curr = schedule[idx];
    var prev = schedule[(idx - 1 + schedule.length) % schedule.length];
    var currVal = curr[key];
    var prevVal = prev[key];
    if (!Number.isFinite(currVal)) return null;
    if (!Number.isFinite(prevVal)) return currVal;
    var since = minute - curr.startMin;
    if (since < 0) since += 24 * 60;
    if (curr.rampMin > 0 && since < curr.rampMin) {
      var f = since / curr.rampMin;
      return prevVal + (currVal - prevVal) * f;
    }
    return currVal;
  }

  async function fetchRows(hoursBack) {
    var now = Date.now();
    var fromIso = new Date(now - hoursBack * 60 * 60 * 1000).toISOString();
    var toIso = new Date(now).toISOString();
    var base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
    var token = window.localStorage.getItem('authToken.v1') || '';
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    var qs =
      '?fromIso=' + encodeURIComponent(fromIso) +
      '&toIso=' + encodeURIComponent(toIso) +
      '&limit=1500';
    var res = await window.fetch(base + '/api/weather/history' + qs, { headers: headers, cache: 'no-store' });
    if (!res.ok) throw new Error('Weather history HTTP ' + res.status);
    var data = await res.json();
    return Array.isArray(data && data.observations) ? data.observations : [];
  }

  function renderStatusText(schedule) {
    var host = document.querySelector('[data-accordion-body="status"]');
    if (!host || !schedule.length) return;
    var now = Date.now();
    var d = new Date(now);
    var minute = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    var idx = schedule.length - 1;
    for (var i = 0; i < schedule.length; i += 1) {
      if (schedule[i].startMin <= minute) idx = i;
      else break;
    }
    var curr = schedule[idx];
    var prev = schedule[(idx - 1 + schedule.length) % schedule.length];
    var since = minute - curr.startMin;
    if (since < 0) since += 24 * 60;
    var text = curr.rampMin > 0 && since < curr.rampMin
      ? ('Current period: P' + prev.periodNo + ' -> P' + curr.periodNo)
      : ('Current period: P' + curr.periodNo);
    var valueEl = document.getElementById('climateStrategyStatusText');
    if (!valueEl || !host.contains(valueEl)) {
      host.innerHTML =
        '<div class="weather-status-grid"><div class="weather-status-item"><div class="weather-status-value" id="climateStrategyStatusText"></div></div></div>';
      valueEl = document.getElementById('climateStrategyStatusText');
    }
    if (valueEl) valueEl.textContent = text;
  }

  async function refresh() {
    if (!canvasEl || typeof Chart === 'undefined') return;
    try {
      var rows = await fetchRows(24);
      var schedule = buildPeriodSchedule();
      var labels = [];
      var cooling = [];
      var heating = [];
      var measured = [];
      for (var i = 0; i < rows.length; i += 1) {
        var ts = Date.parse(rows[i].obsTimeUtc || '');
        var dt = new Date(ts);
        labels.push(String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'));
        cooling.push(valueAtTime(ts, schedule, 'cooling'));
        heating.push(valueAtTime(ts, schedule, 'heating'));
        measured.push(Number(rows[i].temperature_2m));
      }

      renderStatusText(schedule);

      if (chart) chart.destroy();
      chart = new Chart(canvasEl.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Calculated cooling temperature', data: cooling, borderColor: '#d96f17', tension: 0, pointRadius: 0, borderWidth: 2 },
            { label: 'Calculated heating temperature', data: heating, borderColor: '#2f6fb0', tension: 0, pointRadius: 0, borderWidth: 2 },
            { label: 'Measured air temperature', data: measured, borderColor: '#2e9e5b', tension: 0.25, pointRadius: 0, borderWidth: 2 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom' },
            zoom: {
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
              pan: { enabled: true, mode: 'x' },
            },
          },
          scales: {
            x: {},
            y: {
              ticks: {
                callback: function (v) { return v + ' °C'; },
              },
            },
          },
        },
      });
    } catch (err) {
      if (hostEl) {
        hostEl.innerHTML = '<p class="climate-strategy-placeholder">Failed to load chart data.</p>';
      }
    }
  }

  function mount(host) {
    hostEl = host;
    if (!hostEl) return;
    hostEl.innerHTML =
      '<div class="weather-chart-card"><div class="weather-chart-canvas-wrap" style="height:340px"><canvas id="climateStrategyChartCanvas"></canvas></div></div>';
    canvasEl = document.getElementById('climateStrategyChartCanvas');
    refresh();
  }

  function resize() {
    if (chart && typeof chart.resize === 'function') chart.resize();
  }

  window.ClimateStrategyChart = {
    mount: mount,
    refresh: refresh,
    resize: resize,
  };
})();
