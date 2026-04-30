/**
 * Climate strategy → Settings: temperature control periods (dynamic columns).
 * State: GET /api/climate-strategy/periods, debounced PUT, localStorage snapshot on every edit (fallback if API null/fails),
 * immediate PUT when toggling use period or start anchor; flush PUT on tab hide.
 * Schedule table: all slots Period 1…N. Detail table: only periods with use=yes,
 * renumbered Period 1…M. Setting use=yes on the last slot appends a new period (use=no).
 *
 * Ramp time (per period): when that period becomes active at its start time, the
 * controller is meant to ease each numeric setpoint from the previous period’s
 * targets to this period’s targets over the ramp duration (e.g. 2 h: 17 °C night
 * to 23 °C day after a 07:00 switch, and the reverse after a 19:00 switch).
 * Stored as decimal hours (e.g. "2", "1.5"); legacy "HH:MM" values are shown as hours.
 *
 * Start time row: selector (↑ / - / ↓) then HH:MM (editable; disabled only when period is off).
 */
(function () {
  const MAX_PERIODS = 24;

  var RAMP_TIME_TITLE =
    'When this period starts, setpoints move gradually from the previous period to this one over this duration. Enter hours (e.g. 2 or 1.5 for 90 minutes). Example: 2 h between 17 °C night and 23 °C day.';

  var START_TIME_TITLE =
    '↑ Start follows sunrise. - Fixed clock time: set HH:MM beside the selector. ↓ Start follows sunset.';

  /** Show ramp as decimal hours; accept legacy HH:MM duration as hours+minutes. */
  function rampHoursForDisplay(raw) {
    if (raw == null || raw === '') return '';
    var s = String(raw).trim();
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (m) {
      var h = parseInt(m[1], 10);
      var min = parseInt(m[2], 10);
      if (Number.isFinite(h) && Number.isFinite(min) && min >= 0 && min < 60) {
        var x = h + min / 60;
        var rounded = Math.round(x * 1000) / 1000;
        if (rounded === Math.floor(rounded)) return String(Math.floor(rounded));
        return String(rounded);
      }
    }
    return s;
  }

  function createEmptyDetails() {
    return {
      coolingTemp: 18,
      heatingTemp: 17,
      purgeRh: 75,
      purgeHumidityDeficit: 0,
      purgeVpd: 0,
      rhAbove: 70,
      humidityDeficitBelow: 0,
      maxWaterMix1: 60,
      maxWaterMix2: 0,
      minWaterMix1: 0,
      minWaterMix2: 0,
      offsetWaterMix2: -40,
      maxVentLee: 30,
      maxVentWind: 30,
      minVentLee: 0,
      minVentWind: 0,
    };
  }

  function createEmptyPeriod() {
    return {
      use: false,
      startTimeAnchor: 'fixed',
      startTime: '',
      rampTime: '',
      details: createEmptyDetails(),
    };
  }

  /** Initial layout: Period 1 active, Period 2 inactive (enable it to add a third schedule column). */
  function initialPeriods() {
    const p1 = createEmptyPeriod();
    p1.use = true;
    p1.startTimeAnchor = 'fixed';
    p1.startTime = '05:04';
    p1.rampTime = '2';
    p1.details = Object.assign(createEmptyDetails(), {
      coolingTemp: 21,
      heatingTemp: 19,
      purgeRh: 82,
      rhAbove: 80,
      maxVentLee: 35,
      maxVentWind: 25,
    });

    const p2 = createEmptyPeriod();
    p2.rampTime = '';

    return [p1, p2];
  }

  const DETAIL_ROWS = [
    { label: 'cooling temperature', sub: '', key: 'coolingTemp', unit: '°C' },
    { label: 'heating temperature', sub: '', key: 'heatingTemp', unit: '°C' },
    { label: 'purge if relative humi…', sub: '', key: 'purgeRh', unit: '%' },
    { label: 'purge if humidity deficit…', sub: '', key: 'purgeHumidityDeficit', unit: 'g/m³' },
    { label: 'purge if VPD drops below…', sub: '', key: 'purgeVpd', unit: 'mbar' },
    { label: 'relative humidity above…', sub: '', key: 'rhAbove', unit: '%' },
    { label: 'humidity deficit below…', sub: '', key: 'humidityDeficitBelow', unit: 'g/m³' },
    { label: 'maximum water temp…', sub: 'mixing valve 1', key: 'maxWaterMix1', unit: '°C' },
    { label: 'maximum water temp…', sub: 'mixing valve 2', key: 'maxWaterMix2', unit: '°C' },
    { label: 'minimum water temp…', sub: 'mixing valve 1', key: 'minWaterMix1', unit: '°C' },
    { label: 'minimum water temp…', sub: 'mixing valve 2', key: 'minWaterMix2', unit: '°C' },
    { label: 'offset water temperature', sub: 'mixing valve 2', key: 'offsetWaterMix2', unit: '°C' },
    { label: 'maximum vent position', sub: 'lee', key: 'maxVentLee', unit: '%' },
    { label: 'maximum vent position', sub: 'wind', key: 'maxVentWind', unit: '%' },
    { label: 'minimum vent position', sub: 'lee', key: 'minVentLee', unit: '%' },
    { label: 'minimum vent position', sub: 'wind', key: 'minVentWind', unit: '%' },
  ];

  let periods = initialPeriods();
  var hostEl = null;
  var persistReady = false;
  var persistTimer = null;
  var TOKEN_KEY = 'authToken.v1';
  /** Browser copy so refresh survives before debounced PUT reaches the server. */
  var LOCAL_PERIODS_KEY = 'climateStrategyPeriods.v1';

  function apiUrl(path) {
    var base = (typeof CONFIG !== 'undefined' && CONFIG.backendBaseUrl ? CONFIG.backendBaseUrl : '').replace(/\/$/, '');
    return base + path;
  }

  function authFetch(url, options) {
    var token = window.localStorage.getItem(TOKEN_KEY) || '';
    var headers = Object.assign({}, (options && options.headers) || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    return window.fetch(url, Object.assign({}, options || {}, { headers: headers }));
  }

  function persistLocalSnapshot() {
    try {
      window.localStorage.setItem(LOCAL_PERIODS_KEY, JSON.stringify(getState()));
    } catch (e) {
      /* quota / private mode */
    }
  }

  function readLocalPeriods() {
    try {
      var raw = window.localStorage.getItem(LOCAL_PERIODS_KEY);
      if (!raw) return null;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length < 1) return null;
      return arr.map(normalizePeriodFromServer);
    } catch (e) {
      return null;
    }
  }

  function putPeriodsToServer() {
    if (!persistReady || !hostEl) return Promise.resolve();
    return authFetch(apiUrl('/api/climate-strategy/periods'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periods: getState() }),
    }).catch(function () {
      /* offline or auth; local snapshot still holds latest */
    });
  }

  function flushPersistPeriods() {
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
    return putPeriodsToServer();
  }

  function schedulePersistPeriods() {
    if (!persistReady || !hostEl) return;
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(function () {
      persistTimer = null;
      putPeriodsToServer();
    }, 400);
  }

  function notifyPeriodsChanged() {
    try {
      window.dispatchEvent(new CustomEvent('climate-strategy-periods-changed'));
    } catch (e) {
      /* ignore */
    }
  }

  /** After any edit: save locally immediately, sync server after debounce. */
  function touchPeriodsMutated() {
    persistLocalSnapshot();
    schedulePersistPeriods();
    notifyPeriodsChanged();
  }

  /** Structural edits (use period, start anchor): also flush server now so refresh cannot miss the save. */
  function touchPeriodsMutatedFlushServer() {
    persistLocalSnapshot();
    flushPersistPeriods();
    notifyPeriodsChanged();
  }

  function normalizePeriodFromServer(p) {
    var base = createEmptyPeriod();
    if (!p || typeof p !== 'object') return base;
    base.use = Boolean(p.use);
    base.startTime = typeof p.startTime === 'string' ? p.startTime : '';
    base.startTimeAnchor =
      p.startTimeAnchor === 'sunrise' || p.startTimeAnchor === 'sunset' ? p.startTimeAnchor : 'fixed';
    base.rampTime = p.rampTime != null ? String(p.rampTime) : '';
    base.details = Object.assign(createEmptyDetails(), p.details && typeof p.details === 'object' ? p.details : {});
    return base;
  }

  function loadPeriodsFromApi() {
    return authFetch(apiUrl('/api/climate-strategy/periods'), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('load failed');
      return res.json();
    });
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function ensureTrailingInactive() {
    if (periods.length >= MAX_PERIODS) return;
    var last = periods[periods.length - 1];
    if (last && last.use) {
      periods.push(createEmptyPeriod());
    }
  }

  /** Drop the last slot when it and the one before are both use=no (keeps a single trailing inactive column at most). */
  function trimTrailingDoubleInactive() {
    while (
      periods.length > 1 &&
      !periods[periods.length - 1].use &&
      !periods[periods.length - 2].use
    ) {
      periods.pop();
    }
  }

  function enabledIndices() {
    var ix = [];
    for (var i = 0; i < periods.length; i += 1) {
      if (periods[i].use) ix.push(i);
    }
    return ix;
  }

  function buildClimateSettingsPeriodsAttrs() {
    var parts = [];
    if (typeof CONFIG !== 'undefined' && CONFIG.climateStrategyDetailColumns) {
      var c = CONFIG.climateStrategyDetailColumns;
      var pr = Number(c.paramColRem);
      var sr = Number(c.subColRem);
      var slot = Number(c.periodSlotRem);
      var cr = Number(c.cornerRem);
      if (Number.isFinite(pr)) parts.push('--climate-param-col-width:' + pr + 'rem');
      if (Number.isFinite(sr)) parts.push('--climate-sub-col-width:' + sr + 'rem');
      if (Number.isFinite(slot)) parts.push('--climate-period-slot-width:' + slot + 'rem');
      if (Number.isFinite(cr)) parts.push('--climate-corner-w:' + cr + 'rem');
    }
    return parts.length ? ' style="' + parts.join(';') + '"' : '';
  }

  function buildScheduleTable() {
    var schedColgroup = '<colgroup><col class="climate-settings-col-corner" />';
    for (var sc = 0; sc < periods.length; sc += 1) {
      schedColgroup += '<col class="climate-settings-col-sched-period" />';
    }
    schedColgroup += '</colgroup>';

    var ths =
      '<th class="climate-settings-corner" aria-hidden="true"><span class="climate-settings-period-icon" title="Period order">⇅</span></th>';
    for (var c = 0; c < periods.length; c += 1) {
      var isLast = c === periods.length - 1;
      ths +=
        '<th class="climate-settings-period-head' +
        (isLast ? ' climate-settings-period-head--accent' : '') +
        '">Period ' +
        (c + 1) +
        '</th>';
    }

    var rowUse = '<tr><th scope="row">use period?</th>';
    for (var u = 0; u < periods.length; u += 1) {
      var p = periods[u];
      rowUse +=
        '<td><div class="climate-settings-sched-slot">' +
        '<select class="climate-settings-select climate-settings-select--sched" data-period-use="' +
        u +
        '" aria-label="Use period ' +
        (u + 1) +
        '">' +
        '<option value="yes"' +
        (p.use ? ' selected' : '') +
        '>yes</option>' +
        '<option value="no"' +
        (!p.use ? ' selected' : '') +
        '>no</option>' +
        '</select></div></td>';
    }
    rowUse += '</tr>';

    var rowStart =
      '<tr><th scope="row" title="' +
      escAttr(START_TIME_TITLE) +
      '">start time</th>';
    for (var s = 0; s < periods.length; s += 1) {
      var ps = periods[s];
      var dis = ps.use ? '' : ' disabled';
      var anchor = ps.startTimeAnchor || 'fixed';
      var selSun = anchor === 'sunrise' ? ' selected' : '';
      var selFix = anchor === 'fixed' ? ' selected' : '';
      var selSet = anchor === 'sunset' ? ' selected' : '';
      var timeDis = !ps.use ? ' disabled' : '';
      var timeTitle = 'Clock time (24-hour HH:MM), e.g. 07:00 or 19:00.';
      rowStart += '<td><div class="climate-settings-sched-slot"><div class="climate-settings-start-inline">';
      rowStart +=
        '<select class="climate-settings-select climate-settings-start-anchor"' +
        dis +
        ' data-period-field="startTimeAnchor" data-period-index="' +
        s +
        '" aria-label="Start time mode, period ' +
        (s + 1) +
        '" title="' +
        escAttr(START_TIME_TITLE) +
        '">' +
        '<option value="sunrise" title="Start moves with sunrise"' +
        selSun +
        '>↑</option>' +
        '<option value="fixed" title="Fixed time (HH:MM)"' +
        selFix +
        '>-</option>' +
        '<option value="sunset" title="Start moves with sunset"' +
        selSet +
        '>↓</option>' +
        '</select>' +
        '<div class="climate-settings-start-time-slot">' +
        '<input type="text" class="climate-settings-input climate-settings-input--time"' +
        timeDis +
        ' data-period-field="startTime" data-period-index="' +
        s +
        '" value="' +
        escAttr(ps.startTime || '') +
        '" placeholder="HH:MM" maxlength="5" inputmode="numeric" autocomplete="off" spellcheck="false" title="' +
        escAttr(timeTitle) +
        '" aria-label="Start time period ' +
        (s + 1) +
        '"/>' +
        '</div></div></div></td>';
    }
    rowStart += '</tr>';

    var rowRamp =
      '<tr><th scope="row" title="' +
      escAttr(RAMP_TIME_TITLE) +
      '">period ramp time</th>';
    for (var r = 0; r < periods.length; r += 1) {
      var pr = periods[r];
      var disR = pr.use ? '' : ' disabled';
      var rampVal = rampHoursForDisplay(pr.rampTime);
      rowRamp +=
        '<td><div class="climate-settings-sched-slot">' +
        '<span class="climate-settings-ramp-cell">' +
        '<input type="text" class="climate-settings-input climate-settings-input--narrow"' +
        disR +
        ' data-period-field="rampTime" data-period-index="' +
        r +
        '" value="' +
        escAttr(rampVal) +
        '" inputmode="decimal" autocomplete="off" spellcheck="false" title="' +
        escAttr(RAMP_TIME_TITLE) +
        '" aria-label="Ramp duration in hours, period ' +
        (r + 1) +
        '"/>' +
        '<span class="climate-settings-ramp-unit" aria-hidden="true">h</span>' +
        '</span></div></td>';
    }
    rowRamp += '</tr>';

    return (
      '<div class="climate-settings-subtitle">Temperature control 1</div>' +
      '<div class="climate-settings-table-wrap">' +
      '<table class="weather-report-table climate-settings-table climate-settings-schedule-table">' +
      schedColgroup +
      '<thead><tr>' +
      ths +
      '</tr></thead><tbody>' +
      rowUse +
      rowStart +
      rowRamp +
      '</tbody></table></div>'
    );
  }

  function buildDetailTable() {
    var ix = enabledIndices();
    if (!ix.length) {
      return (
        '<div class="climate-settings-detail-wrap">' +
        '<p class="climate-strategy-placeholder">Enable at least one period to edit setpoints.</p>' +
        '</div>'
      );
    }

    var ths = '<th scope="col" class="climate-settings-detail-label">Parameter</th><th scope="col" class="climate-settings-detail-sub"></th>';
    for (var h = 0; h < ix.length; h += 1) {
      ths += '<th scope="col" class="climate-settings-period-head">Period ' + (h + 1) + '</th>';
    }

    var colgroup = '<colgroup><col class="climate-settings-col-param" /><col class="climate-settings-col-sub" />';
    for (var ci = 0; ci < ix.length; ci += 1) {
      colgroup += '<col class="climate-settings-col-value" />';
    }
    colgroup += '</colgroup>';

    var body = '';
    for (var r = 0; r < DETAIL_ROWS.length; r += 1) {
      var row = DETAIL_ROWS[r];
      body +=
        '<tr><th scope="row" class="climate-settings-param-label">' +
        row.label +
        '</th><td class="climate-settings-param-sub">' +
        (row.sub ? row.sub : ' ') +
        '</td>';
      for (var c = 0; c < ix.length; c += 1) {
        var pi = ix[c];
        var val = periods[pi].details[row.key];
        if (val == null) val = '';
        body +=
          '<td class="climate-settings-value-cell">' +
          '<span class="climate-settings-value-inner">' +
          '<input type="text" inputmode="decimal" class="climate-settings-input climate-settings-input--narrow" data-detail-key="' +
          row.key +
          '" data-period-index="' +
          pi +
          '" value="' +
          escAttr(String(val)) +
          '" aria-label="' +
          escAttr(row.label + ' period ' + (c + 1)) +
          '"/>' +
          '<span class="climate-settings-unit">' +
          row.unit +
          '</span>' +
          '</span>' +
          '</td>';
      }
      body += '</tr>';
    }

    return (
      '<div class="climate-settings-detail-wrap">' +
      '<div class="climate-settings-subtitle climate-settings-subtitle--spaced">Period parameters</div>' +
      '<div class="climate-settings-table-wrap">' +
      '<table class="weather-report-table climate-settings-table climate-settings-detail-table">' +
      colgroup +
      '<thead><tr>' +
      ths +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div></div>'
    );
  }

  function render() {
    if (!hostEl) return;
    hostEl.innerHTML =
      '<div class="climate-settings-periods"' +
      buildClimateSettingsPeriodsAttrs() +
      '>' +
      buildScheduleTable() +
      buildDetailTable() +
      '</div>';
  }

  function onUseChange(index, useYes) {
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= periods.length) return;
    periods[i].use = useYes;
    if (useYes) {
      ensureTrailingInactive();
    }
    trimTrailingDoubleInactive();
    render();
    touchPeriodsMutatedFlushServer();
  }

  function onFieldInput(index, field, value) {
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= periods.length) return;
    if (field === 'startTime' || field === 'rampTime') {
      periods[i][field] = value;
    }
    touchPeriodsMutated();
  }

  function onStartAnchorChange(index, value) {
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= periods.length) return;
    if (value !== 'sunrise' && value !== 'fixed' && value !== 'sunset') return;
    periods[i].startTimeAnchor = value;
    render();
    touchPeriodsMutatedFlushServer();
  }

  function onDetailInput(periodIndex, key, value) {
    var i = Number(periodIndex);
    if (!Number.isFinite(i) || i < 0 || i >= periods.length) return;
    var num = parseFloat(value);
    periods[i].details[key] = Number.isFinite(num) ? num : value;
    touchPeriodsMutated();
  }

  function onHostChange(e) {
    var anchorSel = e.target.closest('select[data-period-field="startTimeAnchor"]');
    if (anchorSel && hostEl && hostEl.contains(anchorSel)) {
      if (anchorSel.disabled) return;
      onStartAnchorChange(anchorSel.getAttribute('data-period-index'), anchorSel.value);
      return;
    }
    var sel = e.target.closest('[data-period-use]');
    if (!sel || !hostEl || !hostEl.contains(sel)) return;
    var idx = sel.getAttribute('data-period-use');
    onUseChange(idx, sel.value === 'yes');
  }

  function onHostInput(e) {
    var inp = e.target.closest('input[data-period-field]');
    if (inp && hostEl && hostEl.contains(inp) && !inp.disabled) {
      onFieldInput(inp.getAttribute('data-period-index'), inp.getAttribute('data-period-field'), inp.value);
      return;
    }
    var din = e.target.closest('input[data-detail-key]');
    if (din && hostEl && hostEl.contains(din)) {
      onDetailInput(din.getAttribute('data-period-index'), din.getAttribute('data-detail-key'), din.value);
    }
  }

  function bindHost() {
    if (!hostEl) return;
    hostEl.removeEventListener('change', onHostChange);
    hostEl.removeEventListener('input', onHostInput);
    hostEl.addEventListener('change', onHostChange);
    hostEl.addEventListener('input', onHostInput);
  }

  function mount(el) {
    if (hostEl) {
      hostEl.removeEventListener('change', onHostChange);
      hostEl.removeEventListener('input', onHostInput);
    }
    hostEl = el;
    persistReady = false;
    hostEl.innerHTML =
      '<p class="climate-strategy-placeholder" role="status">Loading period settings…</p>';
    loadPeriodsFromApi()
      .then(function (payload) {
        var arr = payload && payload.periods;
        if (Array.isArray(arr) && arr.length > 0) {
          periods = arr.map(normalizePeriodFromServer);
          trimTrailingDoubleInactive();
        } else {
          var local = readLocalPeriods();
          if (local && local.length) {
            periods = local;
            trimTrailingDoubleInactive();
          } else {
            periods = initialPeriods();
          }
        }
      })
      .catch(function () {
        var local = readLocalPeriods();
        if (local && local.length) {
          periods = local;
          trimTrailingDoubleInactive();
        } else {
          periods = initialPeriods();
        }
      })
      .then(function () {
        persistLocalSnapshot();
        persistReady = true;
        render();
        bindHost();
        notifyPeriodsChanged();
      });
  }

  function getState() {
    return periods.map(function (p) {
      return {
        use: p.use,
        startTimeAnchor: p.startTimeAnchor || 'fixed',
        startTime: p.startTime,
        rampTime: p.rampTime,
        details: Object.assign({}, p.details),
      };
    });
  }

  window.ClimateStrategyPeriods = { mount: mount, getState: getState };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushPersistPeriods();
  });
  window.addEventListener('pagehide', function () {
    flushPersistPeriods();
  });
})();
