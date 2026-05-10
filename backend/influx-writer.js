'use strict';

const influxClient = require('@influxdata/influxdb-client');
const { InfluxDB, Point } = influxClient;

let writeApi = null;
let logFn = function () {};
let lastErrLog = 0;
let writeFailureSince = 0;
let writePauseUntil = 0;

function logInfluxError(msg, err) {
  var now = Date.now();
  if (now - lastErrLog < 60000) return;
  lastErrLog = now;
  logFn('error', msg, err && err.message ? err.message : err);
}

function shouldSkipWrite() {
  if (!writeApi) return true;
  if (writePauseUntil > Date.now()) return true;
  return false;
}

function recordWriteFailure(err) {
  var now = Date.now();
  if (!writeFailureSince) writeFailureSince = now;
  if (now - writeFailureSince > 10 * 1000 && !writePauseUntil) {
    writePauseUntil = now + 60 * 1000;
    logFn('warn', '[influx] sustained write failures, pausing writes for 60s', {
      message: err && err.message ? err.message : String(err || ''),
    });
  }
}

function recordWriteSuccess() {
  if (writePauseUntil || writeFailureSince) {
    logFn('info', '[influx] writes recovered');
  }
  writeFailureSince = 0;
  writePauseUntil = 0;
}

function installQuietInfluxLogger() {
  try {
    var setLoggerFn =
      (influxClient && typeof influxClient.setLogger === 'function' && influxClient.setLogger) ||
      (influxClient && influxClient.Logger && typeof influxClient.Logger.setLogger === 'function' && influxClient.Logger.setLogger.bind(influxClient.Logger));
    if (typeof setLoggerFn !== 'function') {
      logFn('warn', '[influx] setLogger not found on @influxdata/influxdb-client; default warnings may still appear');
      return;
    }
    setLoggerFn({
      error: function (msg, error) {
        var m = String(msg || '');
        if (/Write to InfluxDB failed/i.test(m) || /Request timed out/i.test(m) || /Max retry time/i.test(m)) {
          recordWriteFailure(error);
          logInfluxError('[influx] write failed', error && error.message ? error.message : (error || msg));
          return;
        }
        logInfluxError('[influx] ' + m, error);
      },
      warn: function (msg, error) {
        var m = String(msg || '');
        if (/Write to InfluxDB failed/i.test(m) || /Request timed out/i.test(m) || /Max retry time/i.test(m)) {
          recordWriteFailure(error);
          return;
        }
        logFn('warn', '[influx] ' + m, error && error.message ? error.message : error);
      },
    });
    logFn('info', '[influx] quiet logger installed');
  } catch (_e) {
    /* ignore */
  }
}

/**
 * Parse Aranet-style topics: Growsmart/{gateway}/sensors/{sensorId}/{suffix}
 * so Influx tags stay bounded (not full topic strings).
 */
function aranetTopicParts(topic) {
  var p = String(topic || '')
    .split('/')
    .filter(Boolean);
  if (p.length >= 5 && p[2] === 'sensors') {
    return { root: p[0], gateway: p[1], sensor: p[3], suffix: p.slice(4).join('_') || 'value' };
  }
  if (p.length >= 2) {
    return { root: p[0], gateway: p[1], sensor: '_', suffix: p[p.length - 1] || 'value' };
  }
  return { root: '_', gateway: '_', sensor: '_', suffix: 'value' };
}

function initInflux(logEvent) {
  logFn = typeof logEvent === 'function' ? logEvent : logFn;
  var url = String(process.env.INFLUX_URL || '').trim();
  var token = String(process.env.INFLUX_TOKEN || '').trim();
  var org = String(process.env.INFLUX_ORG || '').trim();
  var bucket = String(process.env.INFLUX_BUCKET || '').trim();
  if (!url || !token || !org || !bucket) {
    logFn('info', '[influx] disabled (set INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET)');
    return;
  }
  try {
    installQuietInfluxLogger();
    var influx = new InfluxDB({ url: url, token: token, timeout: 5000 });
    writeApi = influx.getWriteApi(org, bucket, 'ms', {
      batchSize: 50,
      flushInterval: 4000,
      maxRetries: 1,
      retryJitter: 200,
      minRetryDelay: 1000,
      maxRetryDelay: 5000,
      maxBufferLines: 2000,
      writeFailed: function (err) {
        recordWriteFailure(err);
        logInfluxError('[influx] write batch failed', err);
        return null;
      },
      writeSuccess: function () {
        recordWriteSuccess();
      },
      writeRetrySkipped: function () {
        recordWriteFailure(new Error('retry skipped (buffer full)'));
      },
    });
    writeApi.useDefaultTags({ source: 'greenctrl-backend' });
    logFn('info', '[influx] write API ready', { url: url, org: org, bucket: bucket });
  } catch (err) {
    writeApi = null;
    logInfluxError('[influx] init failed', err);
  }
}

function writeWeatherObservation(obs) {
  if (shouldSkipWrite() || !obs) return;
  var t = Date.parse(obs.obsTimeUtc || '');
  if (!Number.isFinite(t)) return;
  try {
    var p = new Point('weather').tag('station_id', String(obs.stationID || '')).timestamp(new Date(t));
    if (obs.temperature_2m != null && Number.isFinite(Number(obs.temperature_2m))) {
      p.floatField('temperature_2m', Number(obs.temperature_2m));
    }
    if (obs.relative_humidity_2m != null && Number.isFinite(Number(obs.relative_humidity_2m))) {
      p.floatField('relative_humidity_2m', Number(obs.relative_humidity_2m));
    }
    if (obs.absolute_humidity_2m != null && Number.isFinite(Number(obs.absolute_humidity_2m))) {
      p.floatField('absolute_humidity_2m', Number(obs.absolute_humidity_2m));
    }
    if (obs.wind_speed_10m != null && Number.isFinite(Number(obs.wind_speed_10m))) {
      p.floatField('wind_speed_10m', Number(obs.wind_speed_10m));
    }
    if (obs.shortwave_radiation != null && Number.isFinite(Number(obs.shortwave_radiation))) {
      p.floatField('shortwave_radiation', Number(obs.shortwave_radiation));
    }
    if (obs.winddir != null && Number.isFinite(Number(obs.winddir))) {
      p.intField('winddir', Math.round(Number(obs.winddir)));
    }
    if (obs.pressure != null && Number.isFinite(Number(obs.pressure))) {
      p.floatField('pressure', Number(obs.pressure));
    }
    if (obs.precipRate != null && Number.isFinite(Number(obs.precipRate))) {
      p.floatField('precip_rate', Number(obs.precipRate));
    }
    if (obs.precipTotal != null && Number.isFinite(Number(obs.precipTotal))) {
      p.floatField('precip_total', Number(obs.precipTotal));
    }
    if (obs.epoch != null && Number.isFinite(Number(obs.epoch))) {
      p.intField('epoch_sec', Math.round(Number(obs.epoch)));
    }
    writeApi.writePoint(p);
  } catch (err) {
    logInfluxError('[influx] weather write failed', err);
  }
}

function writeVentilationTemps(payload) {
  if (shouldSkipWrite() || !payload || typeof payload !== 'object') return;
  try {
    var measured = Number(payload.measuredTempC);
    var calculated = Number(payload.calculatedTempC);
    var calcVent = Number(payload.calculatedVentPositionPct);
    var actVent = Number(payload.actualVentPositionPct);
    var cooling = Number(payload.coolingRequiredPct);

    var hasMeasured = Number.isFinite(measured);
    var hasCalculated = Number.isFinite(calculated);
    var hasCalcVent = Number.isFinite(calcVent);
    var hasActVent = Number.isFinite(actVent);
    var hasCooling = Number.isFinite(cooling);

    if (!hasMeasured && !hasCalculated && !hasCalcVent && !hasActVent && !hasCooling) {
      logInfluxError('[influx] ventilation_temps write skipped (no usable fields)', payload);
      return;
    }

    var p = new Point('ventilation_temps').timestamp(new Date());
    if (hasMeasured) p.floatField('measured_temp_c', measured);
    if (hasCalculated) p.floatField('calculated_temp_c', calculated);
    if (hasMeasured && hasCalculated) p.floatField('delta_temp_c', measured - calculated);
    if (hasCalcVent) p.floatField('calculated_vent_position_pct', calcVent);
    if (hasActVent) p.floatField('actual_vent_position_pct', actVent);
    if (hasCooling) p.floatField('cooling_required_pct', cooling);
    if (payload.period != null && String(payload.period).trim()) {
      p.tag('period', String(payload.period).trim().slice(0, 64));
    }
    if (payload.mode != null && String(payload.mode).trim()) {
      p.tag('mode', String(payload.mode).trim().toLowerCase().slice(0, 16));
    }
    writeApi.writePoint(p);
  } catch (err) {
    logInfluxError('[influx] ventilation_temps write failed', err);
  }
}

function writeAranetMqtt(topic, payloadText) {
  if (shouldSkipWrite()) return;
  var mqttOn = String(process.env.INFLUX_WRITE_MQTT || 'true').trim().toLowerCase();
  if (mqttOn === 'false' || mqttOn === '0' || mqttOn === 'no') return;
  var text = String(payloadText || '');
  var parts = aranetTopicParts(topic);
  try {
    var p = new Point('aranet_mqtt')
      .tag('root', parts.root)
      .tag('gateway', parts.gateway)
      .tag('sensor', parts.sensor)
      .tag('suffix', parts.suffix.slice(0, 64))
      .timestamp(new Date());
    var n = Number(text.trim());
    if (Number.isFinite(n) && text.trim() !== '') {
      p.floatField('value', n);
    } else {
      var s = text.length > 2048 ? text.slice(0, 2048) + '…' : text;
      p.stringField('value_str', s);
    }
    writeApi.writePoint(p);
  } catch (err) {
    logInfluxError('[influx] aranet_mqtt write failed', err);
  }
}

function writeAranetState(values) {
  if (shouldSkipWrite() || !values || typeof values !== 'object') return;
  var stateOn = String(process.env.INFLUX_WRITE_ARANET_STATE || 'true').trim().toLowerCase();
  if (stateOn === 'false' || stateOn === '0' || stateOn === 'no') return;
  try {
    var p = new Point('aranet_state').timestamp(new Date());
    var keys = Object.keys(values);
    var wrote = false;
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      var v = values[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        p.floatField(k, v);
        wrote = true;
      }
    }
    if (!wrote) return;
    writeApi.writePoint(p);
  } catch (err) {
    logInfluxError('[influx] aranet_state write failed', err);
  }
}

var ARANET_SENSOR_DOC_MAX_FIELDS = Math.min(120, Math.max(10, Number(process.env.INFLUX_ARANET_SENSOR_MAX_FIELDS) || 80));

/** Safe Influx field key: letters, digits, underscore; avoid empty / leading digit issues. */
function sanitizeInfluxFieldKey(name) {
  var s = String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) return '';
  if (/^[0-9]/.test(s)) s = 'f_' + s;
  return s.slice(0, 120);
}

/**
 * One Influx point per MQTT message for JSON object payloads, tagged by gateway + sensor id
 * from Growsmart/{gw}/sensors/{id}/... so multiple probes do not overwrite each other.
 */
function writeAranetSensorDocument(topic, parsed) {
  if (shouldSkipWrite() || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  var docOn = String(process.env.INFLUX_WRITE_ARANET_SENSOR_DOC || 'true').trim().toLowerCase();
  if (docOn === 'false' || docOn === '0' || docOn === 'no') return;
  var parts = aranetTopicParts(topic);
  try {
    var p = new Point('aranet_sensor')
      .tag('root', parts.root)
      .tag('gateway', parts.gateway)
      .tag('sensor', parts.sensor)
      .timestamp(new Date());
    var keys = Object.keys(parsed);
    var wrote = 0;
    for (var i = 0; i < keys.length && wrote < ARANET_SENSOR_DOC_MAX_FIELDS; i += 1) {
      var k = keys[i];
      var v = parsed[k];
      var fk = sanitizeInfluxFieldKey(k);
      if (!fk) continue;
      if (typeof v === 'number' && Number.isFinite(v)) {
        p.floatField(fk, v);
        wrote += 1;
      } else if (v != null && typeof v !== 'object') {
        var n = Number(String(v).trim());
        if (Number.isFinite(n) && String(v).trim() !== '') {
          p.floatField(fk, n);
          wrote += 1;
        }
      }
    }
    if (!wrote) return;
    writeApi.writePoint(p);
  } catch (err) {
    logInfluxError('[influx] aranet_sensor write failed', err);
  }
}

function shutdownInflux() {
  if (!writeApi) return Promise.resolve();
  var w = writeApi;
  writeApi = null;
  return w
    .close()
    .then(function () {
      logFn('info', '[influx] write API closed');
    })
    .catch(function (err) {
      logInfluxError('[influx] close failed', err);
    });
}

function isHealthy() {
  return Boolean(writeApi) && writePauseUntil <= Date.now();
}

module.exports = {
  initInflux: initInflux,
  writeWeatherObservation: writeWeatherObservation,
  writeVentilationTemps: writeVentilationTemps,
  writeAranetMqtt: writeAranetMqtt,
  writeAranetState: writeAranetState,
  writeAranetSensorDocument: writeAranetSensorDocument,
  shutdownInflux: shutdownInflux,
  isHealthy: isHealthy,
};
