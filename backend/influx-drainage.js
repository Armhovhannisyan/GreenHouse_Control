'use strict';

const { InfluxDB } = require('@influxdata/influxdb-client');

function fluxSafeIdent(s, fallback) {
  var t = String(s || '').replace(/[^a-zA-Z0-9_]/g, '');
  return t || fallback;
}

function fluxSafeTagValue(s) {
  var t = String(s || '').trim();
  if (!/^[a-zA-Z0-9_.\-]+$/.test(t)) return '';
  return t;
}

function readDrainageConfig() {
  return {
    url: String(process.env.INFLUX_URL || '').trim(),
    token: String(process.env.INFLUX_TOKEN || '').trim(),
    org: String(process.env.INFLUX_ORG || '').trim(),
    bucket: String(process.env.INFLUX_BUCKET || '').trim(),
    measurement: fluxSafeIdent(process.env.INFLUX_DRAINAGE_MEASUREMENT, 'aranet_sensor'),
    field: fluxSafeIdent(process.env.INFLUX_DRAINAGE_FIELD, 'drainage_volume'),
    sensorTag: fluxSafeTagValue(process.env.INFLUX_DRAINAGE_SENSOR),
    mode: String(process.env.INFLUX_DRAINAGE_VALUE_MODE || 'increment').trim().toLowerCase(),
    title: String(process.env.INFLUX_DRAINAGE_TITLE || 'Drainage sensor').trim() || 'Drainage sensor',
    subtitle: String(process.env.INFLUX_DRAINAGE_SUBTITLE || '( drenaggio )').trim(),
  };
}

function influxConfigured(cfg) {
  return Boolean(cfg.url && cfg.token && cfg.org && cfg.bucket);
}

function parseBoundaryMs(v) {
  if (v == null || v === '') return NaN;
  var s = String(v).trim();
  if (/^-?\d+$/.test(s)) {
    var n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    if (s.length >= 16) return Math.floor(n / 1000000);
    return n;
  }
  var t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function bucketDay(points, dayStartMs, dayEndMs, mode) {
  var hourly = new Array(24);
  for (var z = 0; z < 24; z += 1) hourly[z] = 0;
  if (!points.length) return { hourly: hourly, total: 0 };

  points.sort(function (a, b) {
    return a.t - b.t;
  });

  var contributions = [];
  if (mode === 'cumulative') {
    for (var i = 1; i < points.length; i += 1) {
      var d = points[i].v - points[i - 1].v;
      if (Number.isFinite(d) && d > 0) {
        contributions.push({ t: points[i].t, v: d });
      }
    }
  } else {
    for (var j = 0; j < points.length; j += 1) {
      var v = points[j].v;
      if (Number.isFinite(v) && v >= 0) {
        contributions.push({ t: points[j].t, v: v });
      }
    }
  }

  var total = 0;
  for (var k = 0; k < contributions.length; k += 1) {
    var t = contributions[k].t;
    var val = contributions[k].v;
    if (t < dayStartMs || t >= dayEndMs) continue;
    total += val;
    var h = Math.floor((t - dayStartMs) / 3600000);
    if (h >= 0 && h < 24) hourly[h] += val;
  }
  return { hourly: hourly, total: total };
}

function fluxTimeLiteral(ms) {
  var s = new Date(Number(ms)).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) {
    return '1970-01-01T00:00:00.000Z';
  }
  return s;
}

function buildFluxRange(bucket, measurement, field, sensorTag, startMs, endMs) {
  var startIso = fluxTimeLiteral(startMs);
  var endIso = fluxTimeLiteral(endMs);
  var lines = [
    'from(bucket: "' + String(bucket).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")',
    '  |> range(start: ' + startIso + ', stop: ' + endIso + ')',
    '  |> filter(fn: (r) => r["_measurement"] == "' + measurement + '")',
    '  |> filter(fn: (r) => r["_field"] == "' + field + '")',
  ];
  if (sensorTag) {
    lines.push('  |> filter(fn: (r) => r["sensor"] == "' + sensorTag + '")');
  }
  lines.push('  |> keep(columns: ["_time", "_value"])');
  return lines.join('\n');
}

/**
 * @param {import('@influxdata/influxdb-client').QueryApi} queryApi
 * @param {string} flux
 * @returns {Promise<{t:number,v:number}[]>}
 */
function queryPoints(queryApi, flux) {
  return queryApi.collectRows(flux).then(function (rows) {
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      var ts = r && r._time;
      var ms = ts instanceof Date ? ts.getTime() : NaN;
      var val = r && r._value != null ? Number(r._value) : NaN;
      if (Number.isFinite(ms) && Number.isFinite(val)) {
        out.push({ t: ms, v: val });
      }
    }
    return out;
  });
}

/**
 * @param {{ yesterdayStart: number, yesterdayEnd: number, todayStart: number, todayEnd: number }} rangesMs
 * @param {(lvl: string, msg: string, extra?: object) => void} [logEvent]
 * @returns {Promise<object>}
 */
async function fetchDrainageDailyPanels(rangesMs, logEvent) {
  var cfg = readDrainageConfig();
  if (!influxConfigured(cfg)) {
    return { ok: false, error: 'influx_disabled', message: 'InfluxDB is not configured on the server.' };
  }

  var ys = rangesMs.yesterdayStart;
  var ye = rangesMs.yesterdayEnd;
  var ts = rangesMs.todayStart;
  var te = rangesMs.todayEnd;
  if (![ys, ye, ts, te].every(function (x) { return Number.isFinite(x); })) {
    return { ok: false, error: 'bad_range', message: 'Invalid or missing time boundaries.' };
  }
  if (ye <= ys || te <= ts) {
    return { ok: false, error: 'bad_range', message: 'Each day range must have end after start.' };
  }
  var maxSpan = 36 * 3600000;
  if (ye - ys > maxSpan || te - ts > maxSpan) {
    return { ok: false, error: 'bad_range', message: 'Day range too wide.' };
  }

  var mode = cfg.mode === 'cumulative' ? 'cumulative' : 'increment';
  var influx = new InfluxDB({ url: cfg.url, token: cfg.token, timeout: 5000 });
  var queryApi = influx.getQueryApi(cfg.org);

  var fluxY = buildFluxRange(cfg.bucket, cfg.measurement, cfg.field, cfg.sensorTag, ys, ye);
  var fluxT = buildFluxRange(cfg.bucket, cfg.measurement, cfg.field, cfg.sensorTag, ts, te);

  try {
    var rowsY = await queryPoints(queryApi, fluxY);
    var rowsT = await queryPoints(queryApi, fluxT);
    var yB = bucketDay(rowsY, ys, ye, mode);
    var tB = bucketDay(rowsT, ts, te, mode);
    return {
      ok: true,
      title: cfg.title,
      subtitle: cfg.subtitle,
      measurement: cfg.measurement,
      field: cfg.field,
      sensorTag: cfg.sensorTag || null,
      valueMode: mode,
      yesterday: { totalMl: yB.total, hourlyMl: yB.hourly },
      today: { totalMl: tB.total, hourlyMl: tB.hourly },
    };
  } catch (err) {
    if (typeof logEvent === 'function') {
      logEvent('error', '[influx] drainage query failed', err && err.message ? err.message : err);
    }
    return {
      ok: false,
      error: 'query_failed',
      message: err && err.message ? String(err.message) : 'Influx query failed.',
    };
  }
}

function readGenericInfluxConfig() {
  return {
    url: String(process.env.INFLUX_URL || '').trim(),
    token: String(process.env.INFLUX_TOKEN || '').trim(),
    org: String(process.env.INFLUX_ORG || '').trim(),
    bucket: String(process.env.INFLUX_BUCKET || '').trim(),
  };
}

function buildVentilationHistoryFlux(bucket, startMs, endMs) {
  var startIso = fluxTimeLiteral(startMs);
  var endIso = fluxTimeLiteral(endMs);
  var fields = [
    'measured_temp_c',
    'calculated_temp_c',
    'actual_vent_position_pct',
    'calculated_vent_position_pct',
  ];
  var fieldFilter = fields
    .map(function (f) { return 'r["_field"] == "' + f + '"'; })
    .join(' or ');
  var lines = [
    'from(bucket: "' + String(bucket).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")',
    '  |> range(start: ' + startIso + ', stop: ' + endIso + ')',
    '  |> filter(fn: (r) => r["_measurement"] == "ventilation_temps")',
    '  |> filter(fn: (r) => ' + fieldFilter + ')',
    '  |> keep(columns: ["_time", "_field", "_value"])',
    '  |> sort(columns: ["_time"], desc: false)',
  ];
  return lines.join('\n');
}

/**
 * Fetch ventilation history for the chart.
 * @param {{ startMs: number, endMs: number }} ranges
 * @param {(lvl: string, msg: string, extra?: object) => void} [logEvent]
 * @returns {Promise<{ ok: boolean, samples?: Array<{at: number, calculatedVent: number|null, actualVent: number|null, measuredTemp: number|null, calculatedTemp: number|null}>, error?: string, message?: string }>}
 */
async function fetchVentilationHistory(ranges, logEvent) {
  var cfg = readGenericInfluxConfig();
  if (!influxConfigured(cfg)) {
    return { ok: false, error: 'influx_disabled', message: 'InfluxDB is not configured on the server.' };
  }
  var startMs = Number(ranges && ranges.startMs);
  var endMs = Number(ranges && ranges.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { ok: false, error: 'bad_range', message: 'Invalid time range.' };
  }
  var maxSpan = 14 * 24 * 3600000;
  if (endMs - startMs > maxSpan) {
    return { ok: false, error: 'bad_range', message: 'Time range too wide.' };
  }
  var influx = new InfluxDB({ url: cfg.url, token: cfg.token, timeout: 5000 });
  var queryApi = influx.getQueryApi(cfg.org);
  var flux = buildVentilationHistoryFlux(cfg.bucket, startMs, endMs);
  try {
    var rows = await queryApi.collectRows(flux);
    var byBucketMs = new Map();
    for (var i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      if (!r || !r._time || !r._field) continue;
      var ts = r._time instanceof Date ? r._time.getTime() : Date.parse(String(r._time));
      if (!Number.isFinite(ts)) continue;
      var bucketKey = Math.floor(ts / 30000) * 30000;
      var existing = byBucketMs.get(bucketKey) || {
        at: bucketKey,
        calculatedVent: null,
        actualVent: null,
        measuredTemp: null,
        calculatedTemp: null,
      };
      var val = r._value != null ? Number(r._value) : NaN;
      if (!Number.isFinite(val)) continue;
      switch (r._field) {
        case 'measured_temp_c':
          existing.measuredTemp = val;
          break;
        case 'calculated_temp_c':
          existing.calculatedTemp = val;
          break;
        case 'actual_vent_position_pct':
          existing.actualVent = val;
          break;
        case 'calculated_vent_position_pct':
          existing.calculatedVent = val;
          break;
        default:
          break;
      }
      byBucketMs.set(bucketKey, existing);
    }
    var samples = Array.from(byBucketMs.values()).sort(function (a, b) {
      return a.at - b.at;
    });
    return { ok: true, samples: samples };
  } catch (err) {
    if (typeof logEvent === 'function') {
      logEvent('error', '[influx] ventilation history query failed', err && err.message ? err.message : err);
    }
    return {
      ok: false,
      error: 'query_failed',
      message: err && err.message ? String(err.message) : 'Influx query failed.',
    };
  }
}

module.exports = {
  readDrainageConfig: readDrainageConfig,
  influxConfigured: influxConfigured,
  parseBoundaryMs: parseBoundaryMs,
  fetchDrainageDailyPanels: fetchDrainageDailyPanels,
  fetchVentilationHistory: fetchVentilationHistory,
};
