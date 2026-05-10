const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const mqtt = require('mqtt');
const nodemailer = require('nodemailer');
const Ewelink = require('ewelink-api');
const { resolveAppRoot } = require('./paths');
const ewelinkApp = require('./ewelink-app');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const influxWriter = require('./influx-writer');
const influxDrainage = require('./influx-drainage');
const ventilationPid = require('./ventilation-pid');

const PORT = Number(process.env.PORT || 3001);
const WEATHER_POLL_MS = 30 * 1000;
/** Background eWeLink device list poll (ms). UI reads `db/sonoff-devices-cache.json` via GET /api/sonoff/devices. */
const SONOFF_DEVICES_POLL_MS = Math.max(10000, Number(process.env.SONOFF_DEVICES_POLL_MS) || 30 * 1000);
/** Optional PLC / meteo station URL for server-side polling (browser does not call the station). */
const SENSOR_STATION_BASE_URL = String(process.env.SENSOR_STATION_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');
const SENSOR_STATION_POLL_MS = Math.max(10000, Number(process.env.SENSOR_STATION_POLL_MS) || 30 * 1000);

const WEATHER_CFG = {
  stationId: process.env.WEATHER_STATION_ID || 'IKOTAY9',
  units: process.env.WEATHER_UNITS || 's',
  apiKey: process.env.WEATHER_API_KEY || '4a09500e731f432b89500e731f532b68',
};

const EMAIL_CFG = {
  from: String(process.env.EMAIL_FROM || 'GreenCtrl <no-reply@greenctrl.local>').trim(),
  host: String(process.env.SMTP_HOST || '').trim(),
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true',
  user: String(process.env.SMTP_USER || '').trim(),
  pass: String(process.env.SMTP_PASS || '').trim(),
};

const AUTH_CFG = {
  // Temporarily disabled by default; set AUTH_REQUIRE_EMAIL_VERIFICATION=true to re-enable.
  requireEmailVerification: String(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION || 'false').trim().toLowerCase() === 'true',
  // Disabled by default for now; set AUTH_ALLOW_REGISTRATION=true to allow new signups.
  allowRegistration: String(process.env.AUTH_ALLOW_REGISTRATION || 'false').trim().toLowerCase() === 'true',
};

/**
 * Dotenv treats `#` as start of an inline comment unless the value is quoted.
 * So `ARANET_MQTT_TOPIC=Growsmart/#` often loads as `Growsmart/` and subscribes
 * to one level only — no Aranet messages. Normalize trailing `/` to `/#`.
 */
function normalizeAranetSubscribeTopic(raw) {
  var t = String(raw || '').trim();
  if (!t) return 'aranet/#';
  if (/[#+]/.test(t)) return t;
  if (t.endsWith('/')) return t + '#';
  return t + '/#';
}

const ARANET_MQTT_CFG = {
  url: String(process.env.ARANET_MQTT_URL || '').trim(),
  topic: normalizeAranetSubscribeTopic(process.env.ARANET_MQTT_TOPIC || 'aranet/#'),
  username: String(process.env.ARANET_MQTT_USERNAME || '').trim(),
  password: String(process.env.ARANET_MQTT_PASSWORD || '').trim(),
  clientId: String(process.env.ARANET_MQTT_CLIENT_ID || '').trim(),
};

/** Max entries returned in /api/sensors/latest mqtt.recentMessages (topic + raw payload). */
const ARANET_MQTT_RECENT_CAP = Math.min(100, Math.max(5, Number(process.env.ARANET_MQTT_RECENT_CAP) || 40));
const ARANET_MQTT_PAYLOAD_LOG_MAX = 4096;
const ARANET_MQTT_LOG_EACH_MESSAGE = /^true|1|yes$/i.test(String(process.env.ARANET_MQTT_LOG_MESSAGES || '').trim());

const aranetLatest = {
  connected: false,
  updatedAt: null,
  lastTopic: null,
  values: {},
  /** @type {{ at: string, topic: string, payload: string }[]} */
  recentMessages: [],
};
let emailTransporter = null;

function getSonoffCfg() {
  return ewelinkApp.loadConfig(process.env, PORT);
}

const APP_ROOT = resolveAppRoot();
const ROOT_DIR = path.join(APP_ROOT, 'greenhouse');
const DB_DIR = path.join(APP_ROOT, 'db');
const DB_FILE = path.resolve(DB_DIR, 'weather-observations.json');
const USERS_FILE = path.resolve(DB_DIR, 'users.json');
const SESSIONS_FILE = path.resolve(DB_DIR, 'sessions.json');
const CLIMATE_STRATEGY_FILE = path.resolve(DB_DIR, 'climate-strategy.json');
const RELAY_MODES_FILE = path.resolve(DB_DIR, 'relay-modes.json');
const VENT_STATE_FILE = path.resolve(DB_DIR, 'vent-state.json');
const VENTILATION_PID_FILE = path.resolve(DB_DIR, 'ventilation-pid.json');
const LOG_DIR = path.join(APP_ROOT, 'logs');
const LOG_FILE = path.resolve(LOG_DIR, 'backend.log');
const SONOFF_DEVICES_CACHE_FILE = path.resolve(DB_DIR, 'sonoff-devices-cache.json');
const STATION_SENSORS_CACHE_FILE = path.resolve(DB_DIR, 'station-sensors-cache.json');

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ observations: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(CLIMATE_STRATEGY_FILE)) {
    fs.writeFileSync(CLIMATE_STRATEGY_FILE, JSON.stringify({ periods: null }, null, 2), 'utf8');
  }
  if (!fs.existsSync(RELAY_MODES_FILE)) {
    fs.writeFileSync(RELAY_MODES_FILE, JSON.stringify({ modes: {} }, null, 2), 'utf8');
  }
  if (!fs.existsSync(VENT_STATE_FILE)) {
    fs.writeFileSync(
      VENT_STATE_FILE,
      JSON.stringify({ lastKnownPct: 0, fullTravelMs: 120000, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  }
  if (!fs.existsSync(VENTILATION_PID_FILE)) {
    fs.writeFileSync(
      VENTILATION_PID_FILE,
      JSON.stringify(
        {
          config: ventilationPid.DEFAULT_CONFIG,
          state: { integral: 0, lastErr: null, lastComputeMs: 0, lastActMs: 0, lastZeroCalibrationAtMs: 0 },
          mode: 'automatic',
          manualHoldUntilMs: 0,
          manualTargetPct: 0,
          latest: null,
        },
        null,
        2
      ),
      'utf8'
    );
  }
  if (!fs.existsSync(SONOFF_DEVICES_CACHE_FILE)) {
    fs.writeFileSync(
      SONOFF_DEVICES_CACHE_FILE,
      JSON.stringify(
        { ok: false, updatedAt: null, error: null, region: null, count: 0, devices: [] },
        null,
        2
      ),
      'utf8'
    );
  }
  if (!fs.existsSync(STATION_SENSORS_CACHE_FILE)) {
    fs.writeFileSync(
      STATION_SENSORS_CACHE_FILE,
      JSON.stringify(
        {
          ok: false,
          updatedAt: null,
          error: null,
          climate: null,
          irrigation: null,
          waterRoom: null,
          energyRoom: null,
        },
        null,
        2
      ),
      'utf8'
    );
  }
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf8');
}

function logEvent(level, message, details) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, message, details: details || null });
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    // Keep app alive even if logging fails.
  }
  const text = `[${ts}] [${String(level || 'info').toUpperCase()}] ${message}`;
  if (level === 'error') console.error(text, details || '');
  else if (level === 'warn') console.warn(text, details || '');
  else console.log(text, details || '');
}

function readDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.observations)) return { observations: [] };
    return parsed;
  } catch (err) {
    return { observations: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function readUsers() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.users) ? parsed : { users: [] };
  } catch (_err) {
    return { users: [] };
  }
}

function writeUsers(usersDb) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), 'utf8');
}

function isUserEmailVerified(user) {
  // Backward compatibility: users created before verification flow are treated as verified.
  if (!user || typeof user !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(user, 'emailVerified')) return Boolean(user.emailVerified);
  return true;
}

function makeVerificationCode() {
  var n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

function getEmailTransporter() {
  if (!EMAIL_CFG.host || !EMAIL_CFG.user || !EMAIL_CFG.pass) return null;
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: EMAIL_CFG.host,
      port: EMAIL_CFG.port,
      secure: EMAIL_CFG.secure,
      auth: { user: EMAIL_CFG.user, pass: EMAIL_CFG.pass },
    });
  }
  return emailTransporter;
}

async function sendVerificationEmail(email, username, code) {
  var transporter = getEmailTransporter();
  var subject = 'GreenCtrl email verification code';
  var text =
    'Hello ' + username + ',\n\n' +
    'Your GreenCtrl verification code is: ' + code + '\n\n' +
    'This code expires in 10 minutes.\n';
  if (!transporter) {
    logEvent('warn', '[auth] SMTP not configured; verification code generated', { email: email, username: username, code: code });
    return { delivered: false, reason: 'smtp_not_configured' };
  }
  await transporter.sendMail({
    from: EMAIL_CFG.from,
    to: email,
    subject: subject,
    text: text,
  });
  return { delivered: true };
}

function issueVerificationForUser(user) {
  user.verifyCode = makeVerificationCode();
  user.verifyCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return user.verifyCode;
}

function ensureMasterUser() {
  const username = 'grower';
  const email = 'grower@local.greenctrl';
  const password = '1q2w3e4r5t!';
  const usersDb = readUsers();
  const existing = usersDb.users.find(function (u) { return String(u.username || '').toLowerCase() === username; });
  const hp = hashPassword(password);
  if (!existing) {
    usersDb.users.push({
      id: crypto.randomBytes(8).toString('hex'),
      username: username,
      email: email,
      passwordHash: hp.hash,
      salt: hp.salt,
      emailVerified: true,
      verifyCode: null,
      verifyCodeExpiresAt: null,
      createdAt: new Date().toISOString(),
      isMasterUser: true,
    });
    writeUsers(usersDb);
    logEvent('warn', '[auth] master user ensured', { username: username });
    return;
  }
  existing.email = existing.email || email;
  existing.passwordHash = hp.hash;
  existing.salt = hp.salt;
  existing.emailVerified = true;
  existing.verifyCode = null;
  existing.verifyCodeExpiresAt = null;
  existing.isMasterUser = true;
  writeUsers(usersDb);
  logEvent('warn', '[auth] master user password refreshed', { username: username });
}

function readSessions() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.sessions) ? parsed : { sessions: [] };
  } catch (_err) {
    return { sessions: [] };
  }
}

function writeSessions(sessionsDb) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsDb, null, 2), 'utf8');
}

function readClimateStrategy() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(CLIMATE_STRATEGY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { periods: null };
  } catch (_err) {
    return { periods: null };
  }
}

function writeClimateStrategy(doc) {
  fs.writeFileSync(CLIMATE_STRATEGY_FILE, JSON.stringify(doc, null, 2), 'utf8');
}

function toFiniteOrNull(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapAranetKey(rawKey) {
  var key = String(rawKey || '').trim().toLowerCase();
  if (!key) return null;
  var aliases = {
    temp: 'airTemp',
    temperature: 'airTemp',
    airtemp: 'airTemp',
    air_temperature: 'airTemp',
    humidity: 'humidity',
    rh: 'humidity',
    relative_humidity: 'humidity',
    leaf_temp: 'leafTemp',
    leaftemp: 'leafTemp',
    leaf_temperature: 'leafTemp',
    par: 'par',
    par_sensor: 'par',
    ppfd: 'par',
    light: 'par',
    slab_ec: 'slabEc',
    slabec: 'slabEc',
    slab_scale: 'slabScale',
    slabscale: 'slabScale',
    plant_scale: 'plantScale',
    plantscale: 'plantScale',
    rtr: 'rtr',
    plant_load_day: 'plantLoadDay',
    plantloadday: 'plantLoadDay',
    co2: 'co2',
    co2_ppm: 'co2',
    co2_ppm_level: 'co2',
    atmospheric_pressure: 'atmosphericPressure',
    pressure: 'atmosphericPressure',
    barometric_pressure: 'atmosphericPressure',
    battery: 'battery',
    battery_voltage: 'batteryVoltage',
    rssi: 'rssi',
    signal_strength: 'rssi',
    absolute_humidity: 'absoluteHumidity',
    dew_point: 'dewPoint',
    dewpoint: 'dewPoint',
    soil_vwc: 'soilVwc',
    soilvwc: 'soilVwc',
    soil_ec: 'soilEc',
    soilec: 'soilEc',
    soil_temp: 'soilTemp',
    soiltemp: 'soilTemp',
    soil_temperature: 'soilTemp',
    voltage: 'voltage',
    current: 'current',
    power: 'power',
    energy: 'energy',
    distance: 'distance',
    angle: 'angle',
    weight: 'weight',
    pulse_count: 'pulseCount',
    pulsecounter: 'pulseCount',
    drainage_volume: 'drainageVolume',
    drainage: 'drainageVolume',
    drainage_ml: 'drainageVolume',
    drainage_amount: 'drainageVolume',
    drain_volume: 'drainageVolume',
    drenaggio: 'drainageVolume',
  };
  return aliases[key] || null;
}

function setAranetValue(k, v) {
  var key = mapAranetKey(k);
  var val = toFiniteOrNull(v);
  if (!key || val == null) return;
  aranetLatest.values[key] = val;
}

/** Last path segment after .../sensors/<sensorId>/ (Aranet PRO style topics). */
function aranetTopicMetricKey(topic) {
  var parts = String(topic || '').split('/').filter(Boolean);
  var si = parts.indexOf('sensors');
  if (si < 0 || si + 2 >= parts.length) return null;
  return parts[parts.length - 1];
}

function updateAranetFromPayload(topic, payloadText) {
  var text = String(payloadText || '').trim();
  if (!text) return;
  var parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    parsed = null;
  }
  if (typeof parsed === 'number' && Number.isFinite(parsed)) {
    var numKey = aranetTopicMetricKey(topic) || String(topic || '').split('/').pop();
    setAranetValue(numKey, parsed);
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    Object.keys(parsed).forEach(function (k) {
      setAranetValue(k, parsed[k]);
    });
  } else {
    var metric = aranetTopicMetricKey(topic);
    if (metric && toFiniteOrNull(text) != null) {
      setAranetValue(metric, text);
    } else {
      var keyFromTopic = String(topic || '').split('/').pop();
      setAranetValue(keyFromTopic, text);
    }
  }
  aranetLatest.updatedAt = new Date().toISOString();
  aranetLatest.lastTopic = topic || null;
  influxWriter.writeAranetState(aranetLatest.values);
}

function calcVpdKpa(tempC, rhPct) {
  var t = toFiniteOrNull(tempC);
  var rh = toFiniteOrNull(rhPct);
  if (t == null || rh == null || rh < 0 || rh > 100) return null;
  var svp = 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  return Number((svp * (1 - rh / 100)).toFixed(3));
}

function buildAranetSensorPayload() {
  var v = aranetLatest.values || {};
  var climateTemp = v.airTemp;
  var humidity = v.humidity;
  var leafTemp = v.leafTemp != null ? v.leafTemp : climateTemp;
  var vpd = calcVpdKpa(leafTemp, humidity);
  return {
    mqtt: {
      connected: Boolean(aranetLatest.connected),
      updatedAt: aranetLatest.updatedAt,
      topic: aranetLatest.lastTopic,
      recentMessages: aranetLatest.recentMessages.slice(),
    },
    aranetRoom: {
      temp: climateTemp,
      humidity: humidity,
      probeName: 'Aranet MQTT',
    },
    precisionGrowing: {
      leafTemp: leafTemp,
      par: v.par != null ? v.par : null,
      slabEc: v.slabEc != null ? v.slabEc : null,
      slabScale: v.slabScale != null ? v.slabScale : null,
      plantScale: v.plantScale != null ? v.plantScale : null,
      rtr: v.rtr != null ? v.rtr : null,
      plantLoadDay: v.plantLoadDay != null ? v.plantLoadDay : null,
      drainageVolume: v.drainageVolume != null ? v.drainageVolume : null,
      vpd: vpd,
    },
    raw: Object.assign({}, v),
  };
}

function startAranetMqttIngestor() {
  if (!ARANET_MQTT_CFG.url) {
    logEvent('info', '[mqtt] Aranet MQTT disabled (ARANET_MQTT_URL not set)');
    return;
  }
  logEvent('info', '[mqtt] ingestor starting', {
    subscribeTopic: ARANET_MQTT_CFG.topic,
    logEachMessage: ARANET_MQTT_LOG_EACH_MESSAGE,
  });
  var opts = {};
  if (ARANET_MQTT_CFG.username) opts.username = ARANET_MQTT_CFG.username;
  if (ARANET_MQTT_CFG.password) opts.password = ARANET_MQTT_CFG.password;
  if (ARANET_MQTT_CFG.clientId) opts.clientId = ARANET_MQTT_CFG.clientId;
  var mqttLoggedFirstRx = false;
  var noPayloadYetTimer = null;
  function scheduleNoPayloadWarning() {
    if (noPayloadYetTimer) clearTimeout(noPayloadYetTimer);
    noPayloadYetTimer = setTimeout(function () {
      noPayloadYetTimer = null;
      if (!mqttLoggedFirstRx) {
        logEvent('warn', '[mqtt] no payloads in 120s after subscribe', {
          topic: ARANET_MQTT_CFG.topic,
          hint: 'Aranet may use a different root topic, or the base station is not publishing to this cluster.',
        });
      }
    }, 120000);
  }
  var client = mqtt.connect(ARANET_MQTT_CFG.url, opts);
  client.on('connect', function () {
    aranetLatest.connected = true;
    mqttLoggedFirstRx = false;
    logEvent('info', '[mqtt] connected', { url: ARANET_MQTT_CFG.url, topic: ARANET_MQTT_CFG.topic });
    client.subscribe(ARANET_MQTT_CFG.topic, function (err) {
      if (err) {
        logEvent('error', '[mqtt] subscribe failed', err && err.message ? err.message : err);
      } else {
        logEvent('info', '[mqtt] subscribed', { topic: ARANET_MQTT_CFG.topic });
        scheduleNoPayloadWarning();
      }
    });
  });
  client.on('message', function (topic, payload) {
    var text = payload.toString('utf8');
    if (noPayloadYetTimer) {
      clearTimeout(noPayloadYetTimer);
      noPayloadYetTimer = null;
    }
    if (!mqttLoggedFirstRx) {
      mqttLoggedFirstRx = true;
      logEvent('info', '[mqtt] first message received', { topic: String(topic || ''), bytes: text.length });
    } else if (ARANET_MQTT_LOG_EACH_MESSAGE) {
      var preview = text.length > 160 ? text.slice(0, 160) + '…' : text;
      logEvent('info', '[mqtt] message', { topic: String(topic || ''), bytes: text.length, preview: preview });
    }
    var logPayload = text;
    if (logPayload.length > ARANET_MQTT_PAYLOAD_LOG_MAX) {
      logPayload = logPayload.slice(0, ARANET_MQTT_PAYLOAD_LOG_MAX) + '…';
    }
    aranetLatest.recentMessages.push({
      at: new Date().toISOString(),
      topic: String(topic || ''),
      payload: logPayload,
    });
    while (aranetLatest.recentMessages.length > ARANET_MQTT_RECENT_CAP) {
      aranetLatest.recentMessages.shift();
    }
    influxWriter.writeAranetMqtt(topic, text);
    var parsedInflux = null;
    try {
      parsedInflux = JSON.parse(text);
    } catch (_parseInflux) {
      parsedInflux = null;
    }
    if (parsedInflux && typeof parsedInflux === 'object' && !Array.isArray(parsedInflux)) {
      influxWriter.writeAranetSensorDocument(topic, parsedInflux);
    }
    updateAranetFromPayload(topic, text);
  });
  client.on('reconnect', function () {
    logEvent('warn', '[mqtt] reconnecting');
  });
  client.on('offline', function () {
    logEvent('warn', '[mqtt] client offline');
  });
  client.on('close', function () {
    aranetLatest.connected = false;
    logEvent('warn', '[mqtt] connection closed');
  });
  client.on('error', function (err) {
    logEvent('error', '[mqtt] client error', err && err.message ? err.message : err);
  });
}

function relayModeKey(deviceId, channel) {
  return String(deviceId || '').trim() + ':' + String(Number(channel));
}

function readRelayModes() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(RELAY_MODES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.modes && typeof parsed.modes === 'object' ? parsed : { modes: {} };
  } catch (_err) {
    return { modes: {} };
  }
}

function writeRelayModes(doc) {
  fs.writeFileSync(RELAY_MODES_FILE, JSON.stringify(doc, null, 2), 'utf8');
}

function getRelayMode(deviceId, channel) {
  const doc = readRelayModes();
  const key = relayModeKey(deviceId, channel);
  const mode = String((doc.modes || {})[key] || '').toLowerCase();
  return mode === 'manual' ? 'manual' : 'automatic';
}

function parseBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (chunk) { data += chunk.toString('utf8'); });
    req.on('end', function () {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const p = hashPassword(password, user.salt);
  return p.hash === user.passwordHash;
}

function createSession(userId) {
  const sessionsDb = readSessions();
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  sessionsDb.sessions.push({
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  sessionsDb.sessions = sessionsDb.sessions.filter(function (s) {
    return Date.parse(s.expiresAt || '') > Date.now();
  });
  writeSessions(sessionsDb);
  return token;
}

function authUserFromReq(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  const sessionsDb = readSessions();
  const session = sessionsDb.sessions.find(function (s) {
    return s.token === token && Date.parse(s.expiresAt || '') > Date.now();
  });
  if (!session) return null;
  const usersDb = readUsers();
  const user = usersDb.users.find(function (u) { return u.id === session.userId; });
  if (!user) return null;
  return { id: user.id, username: user.username, token };
}

function unauthorized(res) {
  json(res, 401, { error: 'Unauthorized' });
}

const ewelinkClientsByRegion = {};

function hasEwelinkLegacyCredentials() {
  const cfg = getSonoffCfg();
  return Boolean(cfg.email && cfg.password);
}

function getEwelinkClient() {
  const cfg = getSonoffCfg();
  return getEwelinkClientForRegion(cfg.region);
}

function getEwelinkClientForRegion(region) {
  if (!hasEwelinkLegacyCredentials()) {
    throw new Error('Missing EWELINK_EMAIL or EWELINK_PASSWORD');
  }
  const cfg = getSonoffCfg();
  const key = String(region || cfg.region || 'eu').toLowerCase();
  if (!ewelinkClientsByRegion[key]) {
    ewelinkClientsByRegion[key] = new Ewelink({
      email: cfg.email,
      password: cfg.password,
      region: key,
    });
  }
  return ewelinkClientsByRegion[key];
}

function getErrorInfo(nonArrayResponse) {
  return {
    code: nonArrayResponse && Number.isFinite(nonArrayResponse.error) ? nonArrayResponse.error : null,
    details: nonArrayResponse && nonArrayResponse.msg ? nonArrayResponse.msg : 'Unknown eWeLink response',
  };
}

async function getDevicesWithRegionFallback() {
  const cfg = getSonoffCfg();
  const primary = String(cfg.region || 'eu').toLowerCase();
  const candidates = [primary, 'eu', 'us', 'cn', 'as'].filter(function (v, i, a) {
    return a.indexOf(v) === i;
  });
  let lastErr = { code: null, details: 'No response from eWeLink' };
  for (let i = 0; i < candidates.length; i += 1) {
    const region = candidates[i];
    const client = getEwelinkClientForRegion(region);
    // eslint-disable-next-line no-await-in-loop
    const devices = await client.getDevices();
    if (Array.isArray(devices)) {
      return { region, devices };
    }
    const e = getErrorInfo(devices);
    lastErr = e;
    logEvent('warn', '[sonoff] get devices non-array response', { region, code: e.code, msg: e.details });
  }
  throw new Error((lastErr.code ? `code ${lastErr.code}: ` : '') + lastErr.details);
}

async function fetchSonoffDevicesCombined() {
  const cfg = getSonoffCfg();
  const oauth = ewelinkApp.readOauth();
  if (ewelinkApp.hasAppCredentials(cfg) && oauth && oauth.data && oauth.data.accessToken) {
    return ewelinkApp.fetchDevicesOAuth(cfg);
  }
  if (hasEwelinkLegacyCredentials()) {
    return getDevicesWithRegionFallback();
  }
  throw new Error(
    'eWeLink not configured. Add EWELINK_APP_ID + EWELINK_APP_SECRET, set redirect URL in developer portal to match EWELINK_OAUTH_REDIRECT_URL, then open GET /api/sonoff/oauth/start while logged in. Or set EWELINK_EMAIL + EWELINK_PASSWORD for legacy mode.'
  );
}

async function controlSonoffCombined(deviceId, state, channel, options) {
  const cfg = getSonoffCfg();
  const oauth = ewelinkApp.readOauth();
  const mergedOptions = Object.assign({}, options || {}, { logEvent: logEvent });
  if (ewelinkApp.hasAppCredentials(cfg) && oauth && oauth.data && oauth.data.accessToken) {
    return ewelinkApp.controlThingOAuth(cfg, deviceId, state, channel, mergedOptions);
  }
  if (hasEwelinkLegacyCredentials()) {
    const client = getEwelinkClient();
    logEvent('info', '[sonoff] legacy relay control request', {
      deviceId: deviceId,
      state: state,
      channel: channel,
      source: mergedOptions.source || 'unknown',
    });
    return client.setDevicePowerState(deviceId, state, channel);
  }
  throw new Error('eWeLink not configured (OAuth or legacy credentials).');
}

let activeVentMoveJob = null;

/** Live job holds `offTimer` (Node Timeout) — never pass raw `activeVentMoveJob` to JSON.stringify. */
function serializeLiveVentMoveJob() {
  if (!activeVentMoveJob) return null;
  const j = activeVentMoveJob;
  const startedAt = Number(j.startedAt);
  const pulseMs = Number(j.pulseMs);
  return {
    jobId: j.jobId,
    source: j.source,
    direction: j.direction,
    pulseMs: pulseMs,
    startedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : null,
    stopAt: Number.isFinite(startedAt) && Number.isFinite(pulseMs) ? new Date(startedAt + pulseMs).toISOString() : null,
    onId: j.onId,
    onCh: j.onCh,
    offId: j.offId,
    offCh: j.offCh,
  };
}

function readVentState() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(VENT_STATE_FILE, 'utf8');
    const x = JSON.parse(raw);
    return {
      lastKnownPct: Number.isFinite(Number(x && x.lastKnownPct)) ? Math.max(0, Math.min(100, Number(x.lastKnownPct))) : 0,
      fullTravelMs: Number.isFinite(Number(x && x.fullTravelMs)) ? Math.max(30000, Math.min(2 * 60 * 60 * 1000, Number(x.fullTravelMs))) : 120000,
      updatedAt: x && x.updatedAt ? String(x.updatedAt) : null,
    };
  } catch (_err) {
    return { lastKnownPct: 0, fullTravelMs: 120000, updatedAt: null };
  }
}

function writeVentState(patch) {
  const cur = readVentState();
  const next = Object.assign({}, cur, patch || {}, { updatedAt: new Date().toISOString() });
  if (Number.isFinite(Number(next.lastKnownPct))) next.lastKnownPct = Math.max(0, Math.min(100, Number(next.lastKnownPct)));
  if (Number.isFinite(Number(next.fullTravelMs))) next.fullTravelMs = Math.max(30000, Math.min(2 * 60 * 60 * 1000, Number(next.fullTravelMs)));
  fs.writeFileSync(VENT_STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function clearVentStateActiveJob() {
  const cur = readVentState();
  if (cur && cur.activeJob) {
    writeVentState({ activeJob: null });
  }
}

async function stopVentOutputsSafe(job, sourceTag) {
  const src = String(sourceTag || 'ventilation-safe-stop');
  if (!job) return;
  const onId = String(job.onId || '').trim();
  const onCh = Number(job.onCh);
  const offId = String(job.offId || '').trim();
  const offCh = Number(job.offCh);
  const tries = [0, 1];
  for (let i = 0; i < tries.length; i += 1) {
    if (onId && Number.isFinite(onCh)) {
      try { // eslint-disable-next-line no-await-in-loop
        await controlSonoffCombined(onId, 'off', onCh, { source: src });
      } catch (_err) {}
    }
    if (offId && Number.isFinite(offCh)) {
      try { // eslint-disable-next-line no-await-in-loop
        await controlSonoffCombined(offId, 'off', offCh, { source: src });
      } catch (_err) {}
    }
    if (i === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
    }
  }
}

function clearActiveVentMoveJob(reason) {
  if (!activeVentMoveJob) return;
  if (activeVentMoveJob.offTimer) {
    clearTimeout(activeVentMoveJob.offTimer);
  }
  logEvent('info', '[vent-job] cleared', {
    jobId: activeVentMoveJob.jobId,
    reason: reason || 'unknown',
  });
  activeVentMoveJob = null;
  clearVentStateActiveJob();
}

async function startVentMoveJob(payload) {
  const openId = String(payload.openDeviceId || '').trim();
  const closeId = String(payload.closeDeviceId || '').trim();
  const openCh = Number(payload.openChannel);
  const closeCh = Number(payload.closeChannel);
  const stateDoc = readVentState();
  const requestedTargetPct = Number(payload.targetPct);
  const requestedFromPct = Number(payload.fromPct);
  const requestedFullTravelMs = Number(payload.fullTravelMs);
  const fromPct = Number.isFinite(requestedFromPct) ? Math.max(0, Math.min(100, requestedFromPct)) : stateDoc.lastKnownPct;
  const targetPct = Number.isFinite(requestedTargetPct) ? Math.max(0, Math.min(100, requestedTargetPct)) : null;
  const fullTravelMs = Number.isFinite(requestedFullTravelMs)
    ? Math.max(30000, Math.min(2 * 60 * 60 * 1000, Math.round(requestedFullTravelMs)))
    : stateDoc.fullTravelMs;
  const direction = targetPct != null
    ? targetPct >= fromPct ? 'open' : 'close'
    : String(payload.direction || '').toLowerCase();
  const pulseMs = targetPct != null
    ? Math.min(Math.max(Math.round(fullTravelMs * (Math.abs(targetPct - fromPct) / 100)), 300), 15 * 60 * 1000)
    : Math.round(Number(payload.pulseMs));
  const source = String(payload.source || 'ventilation-manual').toLowerCase();

  if (!openId || !closeId || !Number.isFinite(openCh) || !Number.isFinite(closeCh)) {
    throw new Error('open/close device and channel are required');
  }
  if (!['open', 'close'].includes(direction)) {
    throw new Error('direction must be open or close');
  }
  if (!Number.isFinite(pulseMs) || pulseMs < 300 || pulseMs > 15 * 60 * 1000) {
    throw new Error('pulseMs must be between 300 and 900000');
  }

  clearActiveVentMoveJob('superseded');
  const jobId = crypto.randomBytes(6).toString('hex');
  const onId = direction === 'open' ? openId : closeId;
  const onCh = direction === 'open' ? openCh : closeCh;
  const offId = direction === 'open' ? closeId : openId;
  const offCh = direction === 'open' ? closeCh : openCh;

  writeVentState({ lastKnownPct: fromPct, fullTravelMs: fullTravelMs });
  logEvent('info', '[vent-job] start', {
    jobId, source, direction, pulseMs, onId, onCh, offId, offCh, fromPct, targetPct, fullTravelMs,
  });
  await controlSonoffCombined(offId, 'off', offCh, { source: source + '-server-job' }).catch(function () {});
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  await controlSonoffCombined(onId, 'on', onCh, { source: source + '-server-job' });

  const startedAt = Date.now();
  activeVentMoveJob = {
    jobId,
    source,
    direction,
    onId,
    onCh,
    offId,
    offCh,
    pulseMs,
    startedAt,
    offTimer: setTimeout(function () {
      stopVentOutputsSafe({ onId: onId, onCh: onCh, offId: offId, offCh: offCh }, source + '-server-job')
        .then(function () {
          if (targetPct != null) {
            writeVentState({ lastKnownPct: targetPct, fullTravelMs: fullTravelMs });
          }
          logEvent('info', '[vent-job] stop success', { jobId, onId, onCh, elapsedMs: Date.now() - startedAt });
        })
        .catch(function (err) {
          logEvent('error', '[vent-job] stop failed', { jobId, onId, onCh, error: err && err.message ? err.message : String(err) });
        })
        .finally(function () {
          if (activeVentMoveJob && activeVentMoveJob.jobId === jobId) activeVentMoveJob = null;
          clearVentStateActiveJob();
        });
    }, pulseMs),
  };
  writeVentState({
    activeJob: {
      jobId: jobId,
      source: source,
      onId: onId,
      onCh: onCh,
      offId: offId,
      offCh: offCh,
      startedAtMs: startedAt,
      stopAtMs: startedAt + pulseMs,
    },
  });

  return {
    jobId,
    source,
    direction,
    pulseMs,
    fromPct,
    targetPct,
    fullTravelMs,
    stopAt: new Date(startedAt + pulseMs).toISOString(),
  };
}

function ensureVentJobWatchdog() {
  setInterval(function () {
    if (!activeVentMoveJob) return;
    const now = Date.now();
    const deadline = Number(activeVentMoveJob.startedAt) + Number(activeVentMoveJob.pulseMs) + 5000;
    if (!(now >= deadline)) return;
    const jobId = activeVentMoveJob.jobId;
    const onId = activeVentMoveJob.onId;
    const onCh = activeVentMoveJob.onCh;
    const offId = activeVentMoveJob.offId;
    const offCh = activeVentMoveJob.offCh;
    clearActiveVentMoveJob('watchdog-timeout');
    stopVentOutputsSafe({ onId: onId, onCh: onCh, offId: offId, offCh: offCh }, 'ventilation-watchdog')
      .then(function () {
        logEvent('warn', '[vent-job] watchdog forced stop', { jobId: jobId, onId: onId, onCh: onCh });
      })
      .catch(function (err) {
        logEvent('error', '[vent-job] watchdog stop failed', { jobId: jobId, error: err && err.message ? err.message : String(err) });
      });
  }, 2000);
}

function recoverVentJobFromStateOnBoot() {
  const st = readVentState();
  const aj = st && st.activeJob && typeof st.activeJob === 'object' ? st.activeJob : null;
  if (!aj) return;
  const onId = String(aj.onId || '').trim();
  const onCh = Number(aj.onCh);
  const stopAtMs = Number(aj.stopAtMs);
  if (!onId || !Number.isFinite(onCh) || !Number.isFinite(stopAtMs)) {
    clearVentStateActiveJob();
    return;
  }
  const now = Date.now();
  const delayMs = Math.max(0, stopAtMs - now);
  logEvent('warn', '[vent-job] recovered from db', { jobId: aj.jobId || null, onId: onId, onCh: onCh, delayMs: delayMs });
  setTimeout(function () {
    stopVentOutputsSafe({ onId: onId, onCh: onCh, offId: aj.offId, offCh: aj.offCh }, 'ventilation-recover')
      .then(function () {
        logEvent('warn', '[vent-job] recovered stop executed', { jobId: aj.jobId || null, onId: onId, onCh: onCh });
      })
      .catch(function (err) {
        logEvent('error', '[vent-job] recovered stop failed', { jobId: aj.jobId || null, error: err && err.message ? err.message : String(err) });
      })
      .finally(function () {
        clearVentStateActiveJob();
      });
  }, delayMs);
}

let ventTargetCache = { value: null, atMs: 0 };

function readVentTargetsOverride() {
  try {
    const raw = fs.readFileSync(VENT_STATE_FILE, 'utf8');
    const x = JSON.parse(raw);
    const t = x && x.targets && typeof x.targets === 'object' ? x.targets : null;
    if (!t) return null;
    const openId = String(t.openId || '').trim();
    const closeId = String(t.closeId || '').trim();
    const openCh = Number(t.openCh);
    const closeCh = Number(t.closeCh);
    if (!openId || !closeId || !Number.isFinite(openCh) || !Number.isFinite(closeCh)) return null;
    return { openId, closeId, openCh, closeCh };
  } catch (_e) {
    return null;
  }
}

function resolveVentTargetsSync() {
  const override = readVentTargetsOverride();
  if (override) return override;
  if (ventTargetCache.value && Date.now() - ventTargetCache.atMs < 5 * 60 * 1000) {
    return ventTargetCache.value;
  }
  return null;
}

async function resolveVentTargetsAsync() {
  const override = readVentTargetsOverride();
  if (override) {
    ventTargetCache = { value: override, atMs: Date.now() };
    return override;
  }
  if (ventTargetCache.value && Date.now() - ventTargetCache.atMs < 5 * 60 * 1000) {
    return ventTargetCache.value;
  }
  try {
    const cacheDoc = readSonoffDevicesCacheDoc();
    const simple = Array.isArray(cacheDoc.devices) ? cacheDoc.devices : [];
    const vent = simple.find(function (d) {
      const name = String(d && d.name ? d.name : '').trim();
      const switches = Array.isArray(d && d.switches) ? d.switches : [];
      return name === 'W1_W2_L_MV1' && switches.length >= 2 && d && d.deviceid;
    });
    if (!vent) {
      logEvent('warn', '[vent-pid] W1_W2_L_MV1 not found among sonoff devices', {
        deviceCount: simple.length,
        names: simple.map(function (d) { return d && d.name ? d.name : null; }).filter(Boolean),
      });
      return null;
    }
    const out = {
      openId: String(vent.deviceid),
      closeId: String(vent.deviceid),
      openCh: 2,
      closeCh: 1,
    };
    ventTargetCache = { value: out, atMs: Date.now() };
    logEvent('info', '[vent-pid] vent targets resolved', out);
    return out;
  } catch (err) {
    logEvent('warn', '[vent-pid] target resolve failed', err && err.message ? err.message : err);
    return null;
  }
}

function readWeatherCurrentForPid() {
  try {
    const db = readDb();
    const obs = Array.isArray(db.observations) ? db.observations : [];
    if (!obs.length) return {};
    const last = obs[obs.length - 1];
    return {
      shortwave_radiation: numOrNull(last.shortwave_radiation),
      wind_speed_10m: numOrNull(last.wind_speed_10m),
      temperature_2m: numOrNull(last.temperature_2m),
    };
  } catch (_e) {
    return {};
  }
}

function isPlausibleIndoorTempC(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return false;
  if (n < -30 || n > 60) return false;
  if (n === 0) return false;
  return true;
}

function isPlausibleIndoorHumidityPct(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return false;
  if (n <= 0 || n > 100) return false;
  return true;
}

function readAranetTempForPid() {
  try {
    const v = aranetLatest && aranetLatest.values ? aranetLatest.values : {};
    if (isPlausibleIndoorTempC(v.airTemp)) return Number(v.airTemp);
    if (isPlausibleIndoorTempC(v.temperature)) return Number(v.temperature);
    return null;
  } catch (_e) {
    return null;
  }
}

let lastSonoffIndoorTempC = null;
let lastSonoffIndoorTempAtMs = 0;
let lastSonoffIndoorDeviceName = null;

function pickClimateDeviceFromSonoff(devices) {
  if (!Array.isArray(devices) || !devices.length) return null;
  const preferredId = String(process.env.SONOFF_CLIMATE_DEVICE_ID || '').trim();
  if (preferredId) {
    const m = devices.find(function (d) {
      return d
        && String(d.deviceid || '') === preferredId
        && isPlausibleIndoorTempC(d.temperature);
    });
    if (m) return m;
  }
  const both = devices.find(function (d) {
    return d
      && isPlausibleIndoorTempC(d.temperature)
      && isPlausibleIndoorHumidityPct(d.humidity);
  });
  if (both) return both;
  return null;
}

function readIndoorTempForPid() {
  const aranet = readAranetTempForPid();
  if (isPlausibleIndoorTempC(aranet)) return Number(aranet);
  if (
    isPlausibleIndoorTempC(lastSonoffIndoorTempC)
    && Date.now() - lastSonoffIndoorTempAtMs < 10 * 60 * 1000
  ) {
    return Number(lastSonoffIndoorTempC);
  }
  return null;
}

let ventilationPidWorker = null;

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstNum(a, b, c) {
  var n = numOrNull(a);
  if (n != null) return n;
  n = numOrNull(b);
  if (n != null) return n;
  return numOrNull(c);
}

function pickSonoffSwitchChannelName(s) {
  if (!s || typeof s !== 'object') return null;
  const candidates = [s.name, s.outletName, s.channelName, s.alias, s.switchName];
  for (let i = 0; i < candidates.length; i += 1) {
    const v = candidates[i];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function mapSonoffSwitchForClient(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { outlet: s.outlet, switch: s.switch };
  const cn = pickSonoffSwitchChannelName(s);
  if (cn) o.name = cn;
  return o;
}

function simplifySonoffDevice(d) {
  if (!d) return null;
  const params = d.params || {};
  var switchesFromParams = Array.isArray(params.switches)
    ? params.switches.map(mapSonoffSwitchForClient)
    : null;
  var switchesFromTop = Array.isArray(d.switches)
    ? d.switches.map(mapSonoffSwitchForClient)
    : null;
  var switches = switchesFromTop && switchesFromTop.length ? switchesFromTop : switchesFromParams;
  var temperature = firstNum(d.temperature, params.currentTemperature, params.temperature);
  var humidity = firstNum(d.humidity, params.currentHumidity, params.humidity);
  var switchVal = d.switch != null && d.switch !== '' ? d.switch : params.switch || null;
  return {
    deviceid: d.deviceid,
    name: d.name || d.deviceid,
    online: Boolean(d.online),
    brand: d.brandName || d.brand || null,
    productModel: d.productModel || null,
    uiid: d.uiid || null,
    temperature: temperature,
    humidity: humidity,
    switch: switchVal,
    switches: switches,
  };
}

function readSonoffDevicesCacheDoc() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(SONOFF_DEVICES_CACHE_FILE, 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') {
      return { ok: false, updatedAt: null, error: null, region: null, count: 0, devices: [] };
    }
    return {
      ok: Boolean(o.ok),
      updatedAt: o.updatedAt || null,
      error: o.error != null ? String(o.error) : null,
      region: o.region || null,
      count: Array.isArray(o.devices) ? o.devices.length : 0,
      devices: Array.isArray(o.devices) ? o.devices : [],
    };
  } catch (_e) {
    return { ok: false, updatedAt: null, error: null, region: null, count: 0, devices: [] };
  }
}

function writeSonoffDevicesCacheDoc(doc) {
  ensureDbFile();
  fs.writeFileSync(SONOFF_DEVICES_CACHE_FILE, JSON.stringify(doc, null, 2), 'utf8');
}

function updateSonoffIndoorFromDeviceRows(simple) {
  if (!Array.isArray(simple)) return;
  const dev = pickClimateDeviceFromSonoff(simple);
  if (dev && isPlausibleIndoorTempC(dev.temperature)) {
    lastSonoffIndoorTempC = Math.round(Number(dev.temperature) * 10) / 10;
    lastSonoffIndoorTempAtMs = Date.now();
    lastSonoffIndoorDeviceName = String(dev.name || dev.deviceid || '') || null;
  } else if (lastSonoffIndoorTempAtMs && Date.now() - lastSonoffIndoorTempAtMs > 10 * 60 * 1000) {
    lastSonoffIndoorTempC = null;
  }
}

async function pollSonoffDevicesToDb() {
  const prev = readSonoffDevicesCacheDoc();
  try {
    const found = await fetchSonoffDevicesCombined();
    const rawList = Array.isArray(found && found.devices) ? found.devices : [];
    const rows = rawList.map(simplifySonoffDevice).filter(Boolean);
    writeSonoffDevicesCacheDoc({
      ok: true,
      updatedAt: new Date().toISOString(),
      error: null,
      region: found.region || null,
      count: rows.length,
      devices: rows,
    });
    updateSonoffIndoorFromDeviceRows(rows);
    logEvent('info', '[sonoff-cache] refreshed', { count: rows.length, region: found.region || null });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    writeSonoffDevicesCacheDoc({
      ok: false,
      updatedAt: new Date().toISOString(),
      error: msg,
      region: prev.region,
      count: Array.isArray(prev.devices) ? prev.devices.length : 0,
      devices: Array.isArray(prev.devices) ? prev.devices : [],
    });
    logEvent('warn', '[sonoff-cache] poll failed', { message: msg });
  }
}

function roundStation1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10) / 10;
}

function normalizeStationClimateDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const t = firstNum(d.temperature, d.temp);
  const h = firstNum(d.humidity);
  return {
    temp: t,
    humidity: h != null && Number.isFinite(h) ? Math.round(h) : null,
    heating: d.heating ? 'Active' : 'No heating',
    cooling: d.cooling ? 'Active' : 'No cooling',
  };
}

function normalizeStationIrrigationDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const va = Number(d.valves_active);
  const vw = Number(d.valves_waiting);
  return {
    active: va === 0 ? 'No valves' : `${va} active`,
    waiting: vw === 0 ? 'No valves' : `${vw} waiting`,
  };
}

function normalizeStationWaterRoomDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const flow = firstNum(d.flow_rate, d.flow);
  return {
    flow: flow == null ? 0 : roundStation1(flow),
    status: d.status === 'running' ? 'Running' : 'Off',
    recipe: d.recipe != null && Number.isFinite(Number(d.recipe)) ? Number(d.recipe) : 1,
  };
}

function normalizeStationEnergyRoomDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const temp = firstNum(d.boiler_temp, d.temp);
  return {
    temp: temp == null ? null : roundStation1(temp),
    mode: d.mode != null && String(d.mode).trim() ? String(d.mode) : 'Normal',
    program: d.custom_program ? 'On' : 'Off',
  };
}

function readStationSensorsCacheDoc() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(STATION_SENSORS_CACHE_FILE, 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') {
      return {
        ok: false,
        updatedAt: null,
        error: null,
        climate: null,
        irrigation: null,
        waterRoom: null,
        energyRoom: null,
      };
    }
    return {
      ok: Boolean(o.ok),
      updatedAt: o.updatedAt || null,
      error: o.error != null ? String(o.error) : null,
      climate: o.climate && typeof o.climate === 'object' ? o.climate : null,
      irrigation: o.irrigation && typeof o.irrigation === 'object' ? o.irrigation : null,
      waterRoom: o.waterRoom && typeof o.waterRoom === 'object' ? o.waterRoom : null,
      energyRoom: o.energyRoom && typeof o.energyRoom === 'object' ? o.energyRoom : null,
    };
  } catch (_e) {
    return {
      ok: false,
      updatedAt: null,
      error: null,
      climate: null,
      irrigation: null,
      waterRoom: null,
      energyRoom: null,
    };
  }
}

async function httpJsonFromStation(relPath) {
  if (!SENSOR_STATION_BASE_URL) throw new Error('SENSOR_STATION_BASE_URL not set');
  const base = SENSOR_STATION_BASE_URL.endsWith('/') ? SENSOR_STATION_BASE_URL : SENSOR_STATION_BASE_URL + '/';
  const rel = String(relPath || '').replace(/^\//, '');
  const u = new URL(rel, base);
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(relPath + ' HTTP ' + res.status);
  return res.json();
}

async function pollStationSensorsToDb() {
  if (!SENSOR_STATION_BASE_URL) return;
  const prev = readStationSensorsCacheDoc();
  try {
    const [c, i, w, e] = await Promise.all([
      httpJsonFromStation('/api/climate'),
      httpJsonFromStation('/api/irrigation'),
      httpJsonFromStation('/api/water'),
      httpJsonFromStation('/api/energy'),
    ]);
    const doc = {
      ok: true,
      updatedAt: new Date().toISOString(),
      error: null,
      climate: normalizeStationClimateDoc(c),
      irrigation: normalizeStationIrrigationDoc(i),
      waterRoom: normalizeStationWaterRoomDoc(w),
      energyRoom: normalizeStationEnergyRoomDoc(e),
    };
    fs.writeFileSync(STATION_SENSORS_CACHE_FILE, JSON.stringify(doc, null, 2), 'utf8');
    logEvent('info', '[station-cache] refreshed', { base: SENSOR_STATION_BASE_URL });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    fs.writeFileSync(
      STATION_SENSORS_CACHE_FILE,
      JSON.stringify(
        {
          ok: false,
          updatedAt: new Date().toISOString(),
          error: msg,
          climate: prev.climate,
          irrigation: prev.irrigation,
          waterRoom: prev.waterRoom,
          energyRoom: prev.energyRoom,
        },
        null,
        2
      ),
      'utf8'
    );
    logEvent('warn', '[station-cache] poll failed', { message: msg });
  }
}

function weatherUrl() {
  return (
    'https://api.weather.com/v2/pws/observations/current' +
    '?stationId=' + encodeURIComponent(WEATHER_CFG.stationId) +
    '&format=json' +
    '&units=' + encodeURIComponent(WEATHER_CFG.units) +
    '&apiKey=' + encodeURIComponent(WEATHER_CFG.apiKey)
  );
}

function calcAbsoluteHumidity(tempC, rhPct) {
  const t = Number(tempC);
  const rh = Number(rhPct);
  if (!Number.isFinite(t) || !Number.isFinite(rh)) return null;
  const sat = 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  const ah = (sat * (rh / 100) * 216.74) / (273.15 + t);
  return +ah.toFixed(2);
}

function mapObservation(rawObs) {
  let block = rawObs.imperial || {};
  if (WEATHER_CFG.units === 'm') block = rawObs.metric || {};
  if (WEATHER_CFG.units === 's') block = rawObs.metric_si || rawObs.metric || {};
  if (WEATHER_CFG.units === 'h') block = rawObs.imperial || {};
  const temp = block.temp == null ? null : Number(block.temp);
  const rh = rawObs.humidity == null ? null : Number(rawObs.humidity);
  return {
    stationID: rawObs.stationID || WEATHER_CFG.stationId,
    obsTimeUtc: rawObs.obsTimeUtc || null,
    obsTimeLocal: rawObs.obsTimeLocal || null,
    epoch: rawObs.epoch || null,
    temperature_2m: temp,
    relative_humidity_2m: rh,
    absolute_humidity_2m: calcAbsoluteHumidity(temp, rh),
    wind_speed_10m: block.windSpeed == null ? null : block.windSpeed,
    shortwave_radiation: rawObs.solarRadiation == null ? 0 : rawObs.solarRadiation,
    winddir: rawObs.winddir == null ? null : rawObs.winddir,
    pressure: block.pressure == null ? null : block.pressure,
    precipRate: block.precipRate == null ? 0 : block.precipRate,
    precipTotal: block.precipTotal == null ? 0 : block.precipTotal,
  };
}

function fetchWeatherCom() {
  return new Promise(function (resolve, reject) {
    https
      .get(weatherUrl(), function (res) {
        let body = '';
        res.on('data', function (chunk) {
          body += chunk.toString('utf8');
        });
        res.on('end', function () {
          if (res.statusCode < 200 || res.statusCode > 299) {
            reject(new Error('Weather.com HTTP ' + res.statusCode));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            const observations = parsed && parsed.observations ? parsed.observations : [];
            if (!observations.length) {
              reject(new Error('No observations in Weather.com payload'));
              return;
            }
            resolve(mapObservation(observations[0]));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function saveObservation(obs) {
  if (!obs || !obs.obsTimeUtc) return false;
  const db = readDb();
  const exists = db.observations.some(function (row) {
    return row.obsTimeUtc === obs.obsTimeUtc && row.stationID === obs.stationID;
  });
  if (exists) return false;
  db.observations.push(obs);
  if (db.observations.length > 20000) {
    db.observations = db.observations.slice(db.observations.length - 20000);
  }
  writeDb(db);
  return true;
}

function getHistory(hours) {
  const db = readDb();
  const now = Date.now();
  const ms = Math.max(1, Number(hours || 24)) * 60 * 60 * 1000;
  const cutoff = now - ms;
  return db.observations
    .filter(function (row) {
      const t = Date.parse(row.obsTimeUtc || '');
      return Number.isFinite(t) && t >= cutoff;
    })
    .map(function (row) {
      // Backfill derived value for historical rows created before this field existed.
      if (row.absolute_humidity_2m == null) {
        row.absolute_humidity_2m = calcAbsoluteHumidity(row.temperature_2m, row.relative_humidity_2m);
      }
      return row;
    })
    .sort(function (a, b) {
      return Date.parse(a.obsTimeUtc || '') - Date.parse(b.obsTimeUtc || '');
    });
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce(function (a, b) { return a + b; }, 0);
  return +(sum / values.length).toFixed(1);
}

function min(values) {
  if (!values.length) return null;
  return +Math.min.apply(null, values).toFixed(1);
}

function max(values) {
  if (!values.length) return null;
  return +Math.max.apply(null, values).toFixed(1);
}

function reportForRange(rows) {
  const temp = rows.map(function (r) { return r.temperature_2m; }).filter(Number.isFinite);
  const hum = rows.map(function (r) { return r.relative_humidity_2m; }).filter(Number.isFinite);
  const light = rows.map(function (r) { return r.shortwave_radiation; }).filter(Number.isFinite);
  const wind = rows.map(function (r) { return r.wind_speed_10m; }).filter(Number.isFinite);
  const rain = rows.map(function (r) { return r.precipRate; }).filter(Number.isFinite);
  const rainTotal = rows.map(function (r) { return r.precipTotal; }).filter(Number.isFinite);
  return {
    temperature: {
      max: max(temp),
      min: min(temp),
      avg: average(temp),
      avgNight: average(temp.slice(0, Math.max(1, Math.floor(temp.length / 2)))),
    },
    humidity: {
      max: max(hum),
      min: min(hum),
      avgDay: average(hum),
      avgNight: average(hum.slice(0, Math.max(1, Math.floor(hum.length / 2)))),
    },
    sunlight: {
      maxLight: max(light),
      accumulation: +light.reduce(function (a, b) { return a + b; }, 0).toFixed(0),
      sunrise: '06:05',
      sunset: '19:34',
    },
    wind: {
      max: max(wind),
      avg: average(wind),
    },
    rain: {
      avgRate: average(rain),
      total: max(rainTotal),
    },
  };
}

function buildReports() {
  const db = readDb();
  const all = db.observations
    .slice()
    .sort(function (a, b) { return Date.parse(a.obsTimeUtc || '') - Date.parse(b.obsTimeUtc || ''); });
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const todayRows = all.filter(function (r) {
    const t = Date.parse(r.obsTimeUtc || '');
    return Number.isFinite(t) && t >= now - oneDay;
  });
  const yRows = all.filter(function (r) {
    const t = Date.parse(r.obsTimeUtc || '');
    return Number.isFinite(t) && t >= now - 2 * oneDay && t < now - oneDay;
  });
  return {
    stationID: WEATHER_CFG.stationId,
    units: WEATHER_CFG.units,
    yesterday: reportForRange(yRows),
    today: reportForRange(todayRows),
    countToday: todayRows.length,
    countYesterday: yRows.length,
  };
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const absolute = path.join(ROOT_DIR, filePath);
  if (!absolute.startsWith(ROOT_DIR)) {
    notFound(res);
    return;
  }
  fs.readFile(absolute, function (err, data) {
    if (err) {
      notFound(res);
      return;
    }
    const ext = path.extname(absolute).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function toWeatherShape(historyRows) {
  const current = historyRows.length ? historyRows[historyRows.length - 1] : null;
  return {
    current: current
      ? {
          temperature_2m: current.temperature_2m,
          relative_humidity_2m: current.relative_humidity_2m,
          wind_speed_10m: current.wind_speed_10m,
          shortwave_radiation: current.shortwave_radiation,
          absolute_humidity_2m: current.absolute_humidity_2m,
          winddir: current.winddir,
          source: 'local-db',
          sourceUnits: WEATHER_CFG.units === 'm' ? 'metric' : 'imperial',
          stationID: current.stationID,
          obsTimeUtc: current.obsTimeUtc,
        }
      : {
          temperature_2m: null,
          relative_humidity_2m: null,
          wind_speed_10m: null,
          shortwave_radiation: null,
          absolute_humidity_2m: null,
          winddir: null,
          source: 'local-db',
          sourceUnits: WEATHER_CFG.units === 'm' ? 'metric' : 'imperial',
          stationID: WEATHER_CFG.stationId,
          obsTimeUtc: null,
        },
    hourly: {
      time: historyRows.map(function (r) { return r.obsTimeUtc; }),
      temperature_2m: historyRows.map(function (r) { return r.temperature_2m; }),
      relative_humidity_2m: historyRows.map(function (r) { return r.relative_humidity_2m; }),
      absolute_humidity_2m: historyRows.map(function (r) { return r.absolute_humidity_2m; }),
      wind_speed_10m: historyRows.map(function (r) { return r.wind_speed_10m; }),
      winddir: historyRows.map(function (r) { return r.winddir; }),
    },
  };
}

async function pollAndStore() {
  try {
    const obs = await fetchWeatherCom();
    const added = saveObservation(obs);
    if (obs && obs.obsTimeUtc) {
      influxWriter.writeWeatherObservation(obs);
    }
    if (added) {
      logEvent('info', '[poll] saved observation', {
        obsTimeUtc: obs.obsTimeUtc,
        temp: obs.temperature_2m,
        humidity: obs.relative_humidity_2m,
        wind: obs.wind_speed_10m,
      });
    } else {
      logEvent('info', '[poll] duplicate skipped', { obsTimeUtc: obs.obsTimeUtc });
    }
  } catch (err) {
    logEvent('error', '[poll] failed', err && err.message ? err.message : err);
  }
}

const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, { ok: true, ts: new Date().toISOString() });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    });
    res.end();
    return;
  }

  logEvent('info', '[http] request', { method: req.method, pathname, query: parsed.query || {} });

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (!AUTH_CFG.allowRegistration) {
      json(res, 403, { error: 'Registration is disabled' });
      return;
    }
    parseBody(req).then(async function (body) {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const email = String(body.email || '').trim().toLowerCase();
      if (!username || password.length < 6 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        json(res, 400, { error: 'Username, valid email and password min 6 chars are required' });
        return;
      }
      const usersDb = readUsers();
      const exists = usersDb.users.some(function (u) { return u.username === username || String(u.email || '').toLowerCase() === email; });
      if (exists) {
        json(res, 409, { error: 'Username or email already exists' });
        return;
      }
      const id = crypto.randomBytes(8).toString('hex');
      const hp = hashPassword(password);
      const user = {
        id,
        username,
        email,
        passwordHash: hp.hash,
        salt: hp.salt,
        emailVerified: false,
        verifyCode: null,
        verifyCodeExpiresAt: null,
        createdAt: new Date().toISOString(),
      };
      let code = null;
      if (AUTH_CFG.requireEmailVerification) {
        code = issueVerificationForUser(user);
      } else {
        user.emailVerified = true;
        user.verifyCode = null;
        user.verifyCodeExpiresAt = null;
      }
      usersDb.users.push(user);
      writeUsers(usersDb);
      if (AUTH_CFG.requireEmailVerification) {
        try {
          await sendVerificationEmail(email, username, code);
        } catch (mailErr) {
          json(res, 502, { error: 'Failed to send verification email', details: mailErr && mailErr.message ? mailErr.message : String(mailErr) });
          return;
        }
        json(res, 200, {
          ok: true,
          verificationRequired: true,
          user: { id: id, username: username, email: email },
        });
      } else {
        const token = createSession(id);
        json(res, 200, {
          ok: true,
          verificationRequired: false,
          token: token,
          user: { id: id, username: username, email: email },
        });
      }
    }).catch(function (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    });
    return;
  }

  if (pathname === '/api/auth/verify-email' && req.method === 'POST') {
    parseBody(req).then(function (body) {
      const username = String(body.username || '').trim().toLowerCase();
      const email = String(body.email || '').trim().toLowerCase();
      const code = String(body.code || '').trim();
      if (!code || (!username && !email)) {
        json(res, 400, { error: 'username or email, and code are required' });
        return;
      }
      const usersDb = readUsers();
      const user = usersDb.users.find(function (u) {
        return (username && u.username === username) || (email && String(u.email || '').toLowerCase() === email);
      });
      if (!user) {
        json(res, 404, { error: 'User not found' });
        return;
      }
      if (isUserEmailVerified(user)) {
        const tokenAlready = createSession(user.id);
        json(res, 200, { ok: true, token: tokenAlready, user: { id: user.id, username: user.username, email: user.email || null } });
        return;
      }
      const expiresMs = Date.parse(user.verifyCodeExpiresAt || '');
      if (!user.verifyCode || !Number.isFinite(expiresMs) || expiresMs < Date.now()) {
        json(res, 410, { error: 'Verification code expired. Please request a new one.' });
        return;
      }
      if (String(user.verifyCode) !== code) {
        json(res, 401, { error: 'Invalid verification code' });
        return;
      }
      user.emailVerified = true;
      user.verifyCode = null;
      user.verifyCodeExpiresAt = null;
      user.verifiedAt = new Date().toISOString();
      writeUsers(usersDb);
      const token = createSession(user.id);
      json(res, 200, { ok: true, token: token, user: { id: user.id, username: user.username, email: user.email || null } });
    }).catch(function (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    });
    return;
  }

  if (pathname === '/api/auth/resend-verification' && req.method === 'POST') {
    parseBody(req).then(async function (body) {
      const username = String(body.username || '').trim().toLowerCase();
      const email = String(body.email || '').trim().toLowerCase();
      if (!username && !email) {
        json(res, 400, { error: 'username or email is required' });
        return;
      }
      const usersDb = readUsers();
      const user = usersDb.users.find(function (u) {
        return (username && u.username === username) || (email && String(u.email || '').toLowerCase() === email);
      });
      if (!user) {
        json(res, 404, { error: 'User not found' });
        return;
      }
      if (isUserEmailVerified(user)) {
        json(res, 409, { error: 'Email already verified' });
        return;
      }
      if (!user.email) {
        json(res, 400, { error: 'User does not have email set' });
        return;
      }
      const code = issueVerificationForUser(user);
      writeUsers(usersDb);
      try {
        await sendVerificationEmail(user.email, user.username, code);
      } catch (mailErr) {
        json(res, 502, { error: 'Failed to resend verification email', details: mailErr && mailErr.message ? mailErr.message : String(mailErr) });
        return;
      }
      json(res, 200, { ok: true, message: 'Verification code sent' });
    }).catch(function (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    });
    return;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    parseBody(req).then(function (body) {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const usersDb = readUsers();
      const user = usersDb.users.find(function (u) { return u.username === username; });
      if (!user || !verifyPassword(password, user)) {
        json(res, 401, { error: 'Invalid username or password' });
        return;
      }
      if (AUTH_CFG.requireEmailVerification && !isUserEmailVerified(user)) {
        json(res, 403, { error: 'Email not verified. Check your inbox and verify your account first.' });
        return;
      }
      const token = createSession(user.id);
      json(res, 200, { ok: true, token, user: { id: user.id, username: user.username, email: user.email || null } });
    }).catch(function (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    });
    return;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    json(res, 200, { user: { id: authUser.id, username: authUser.username } });
    return;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    const sessionsDb = readSessions();
    sessionsDb.sessions = sessionsDb.sessions.filter(function (s) { return s.token !== authUser.token; });
    writeSessions(sessionsDb);
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/ui-log' && req.method === 'POST') {
    const authUser = authUserFromReq(req);
    parseBody(req)
      .then(function (body) {
        const level = String(body && body.level ? body.level : 'info').toLowerCase();
        const message = String(body && body.message ? body.message : '').trim();
        const details = body && body.details && typeof body.details === 'object' ? body.details : {};
        if (!message) {
          json(res, 400, { error: 'message is required' });
          return;
        }
        logEvent(level, '[ui] ' + message, Object.assign({}, details, {
          userId: authUser && authUser.id ? authUser.id : null,
          username: authUser && authUser.username ? authUser.username : null,
          ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null,
        }));
        json(res, 200, { ok: true });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/influx/ventilation-temps' && req.method === 'POST') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    parseBody(req)
      .then(function (body) {
        const measuredTempC = Number(body && body.measuredTempC);
        const calculatedTempC = Number(body && body.calculatedTempC);
        const calcVentPct = Number(body && body.calculatedVentPositionPct);
        const actVentPct = Number(body && body.actualVentPositionPct);
        const coolingPct = Number(body && body.coolingRequiredPct);
        const anyFinite =
          Number.isFinite(measuredTempC) ||
          Number.isFinite(calculatedTempC) ||
          Number.isFinite(calcVentPct) ||
          Number.isFinite(actVentPct) ||
          Number.isFinite(coolingPct);
        if (!anyFinite) {
          json(res, 400, { error: 'at least one of measuredTempC, calculatedTempC, calculatedVentPositionPct, actualVentPositionPct, coolingRequiredPct is required' });
          return;
        }
        influxWriter.writeVentilationTemps({
          measuredTempC: Number.isFinite(measuredTempC) ? measuredTempC : null,
          calculatedTempC: Number.isFinite(calculatedTempC) ? calculatedTempC : null,
          calculatedVentPositionPct: Number.isFinite(calcVentPct) ? calcVentPct : null,
          actualVentPositionPct: Number.isFinite(actVentPct) ? actVentPct : null,
          coolingRequiredPct: Number.isFinite(coolingPct) ? coolingPct : null,
          period: body && body.period,
          mode: body && body.mode,
        });
        json(res, 200, { ok: true });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/influx/ventilation-history' && req.method === 'GET') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    const hoursRaw = Number(parsed.query.hours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(14 * 24, hoursRaw) : 6;
    const endMs = Date.now();
    const startMs = endMs - hours * 60 * 60 * 1000;
    influxDrainage
      .fetchVentilationHistory({ startMs, endMs }, logEvent)
      .then(function (body) {
        let code = 200;
        if (!body || body.ok !== true) {
          code = 200;
          if (body && body.error === 'influx_disabled') code = 503;
          if (body && body.error === 'bad_range') code = 400;
        }
        json(res, code, body);
      })
      .catch(function (err) {
        json(res, 500, { error: 'history_failed', message: err && err.message ? err.message : 'Failed' });
      });
    return;
  }

  if (pathname === '/api/climate-strategy/periods' && req.method === 'GET') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    const doc = readClimateStrategy();
    json(res, 200, { periods: doc.periods == null ? null : doc.periods });
    return;
  }

  if (pathname === '/api/climate-strategy/periods' && req.method === 'PUT') {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    parseBody(req)
      .then(function (body) {
        const arr = body.periods;
        if (!Array.isArray(arr) || arr.length < 1 || arr.length > 24) {
          json(res, 400, { error: 'periods must be an array of length 1–24' });
          return;
        }
        writeClimateStrategy({ periods: arr });
        json(res, 200, { ok: true });
      })
      .catch(function (err) {
        json(res, 400, { error: err.message || 'Bad request' });
      });
    return;
  }

  if (pathname.indexOf('/api/weather/') === 0) {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
  }

  if (pathname.indexOf('/api/sensors/') === 0) {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
  }

  if (pathname === '/api/weather/current') {
    const rows = getHistory(24 * 7);
    json(res, 200, toWeatherShape(rows));
    return;
  }

  if (pathname === '/api/weather/history') {
    const rows = getHistory(parsed.query.hours || 24);
    json(res, 200, { stationID: WEATHER_CFG.stationId, units: WEATHER_CFG.units, observations: rows });
    return;
  }

  if (pathname === '/api/weather/reports') {
    json(res, 200, buildReports());
    return;
  }

  if (pathname === '/api/sensors/latest' && req.method === 'GET') {
    json(res, 200, buildAranetSensorPayload());
    return;
  }

  if (pathname === '/api/sensors/station' && req.method === 'GET') {
    const doc = readStationSensorsCacheDoc();
    json(res, 200, {
      ok: doc.ok,
      updatedAt: doc.updatedAt,
      error: doc.ok ? null : doc.error,
      climate: doc.climate,
      irrigation: doc.irrigation,
      waterRoom: doc.waterRoom,
      energyRoom: doc.energyRoom,
    });
    return;
  }

  if (pathname === '/api/sensors/drainage-daily' && req.method === 'GET') {
    var dq = parsed.query || {};
    var drainRanges = {
      yesterdayStart: influxDrainage.parseBoundaryMs(dq.yesterdayStart),
      yesterdayEnd: influxDrainage.parseBoundaryMs(dq.yesterdayEnd),
      todayStart: influxDrainage.parseBoundaryMs(dq.todayStart),
      todayEnd: influxDrainage.parseBoundaryMs(dq.todayEnd),
    };
    influxDrainage.fetchDrainageDailyPanels(drainRanges, logEvent).then(function (body) {
      var code = 200;
      if (!body || !body.ok) {
        if (body && body.error === 'influx_disabled') code = 503;
        else if (body && body.error === 'query_failed') code = 502;
        else code = 400;
      }
      json(res, code, body);
    });
    return;
  }

  if (pathname === '/api/sonoff/oauth/callback' && req.method === 'GET') {
    (function () {
      const cfg = getSonoffCfg();
      ewelinkApp
        .oauthCallback(cfg, parsed.query || {}, logEvent)
        .then(function (result) {
          const safe = String(result.message || '').replace(/</g, '&lt;');
          res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>eWeLink</title></head><body style="font-family:system-ui,sans-serif;padding:24px">' +
              (result.ok ? '<h2>eWeLink linked</h2>' : '<h2>eWeLink link failed</h2>') +
              '<p>' +
              safe +
              '</p></body></html>'
          );
        })
        .catch(function (err) {
          logEvent('error', '[sonoff] oauth callback', err && err.message ? err.message : err);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><body><p>OAuth callback error</p></body></html>');
        });
    })();
    return;
  }

  if (pathname.indexOf('/api/sonoff/') === 0) {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
  }

  if ((pathname === '/api/sonoff/oauth/start' && req.method === 'POST') || (pathname === '/api/sonoff/oauth/start' && req.method === 'GET')) {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
    try {
      const cfg = getSonoffCfg();
      const loginUrl = ewelinkApp.oauthStart(cfg, authUser.id, logEvent);
      if (req.method === 'GET') {
        res.writeHead(302, { Location: loginUrl });
        res.end();
        return;
      }
      json(res, 200, { url: loginUrl });
    } catch (err) {
      json(res, 400, { error: err.message || 'OAuth start failed' });
    }
    return;
  }

  if (pathname === '/api/sonoff/devices' && req.method === 'GET') {
    try {
      const doc = readSonoffDevicesCacheDoc();
      const relayModes = readRelayModes().modes || {};
      const rows = Array.isArray(doc.devices) ? doc.devices : [];
      json(res, 200, {
        region: doc.region,
        count: rows.length,
        relayModes: relayModes,
        devices: rows,
        cacheUpdatedAt: doc.updatedAt,
        cacheOk: doc.ok,
        cacheError: doc.ok ? null : doc.error,
      });
    } catch (err) {
      json(res, 400, {
        error: err.message,
        hint: 'Set EWELINK_APP_ID + EWELINK_APP_SECRET and complete OAuth, or set EWELINK_EMAIL + EWELINK_PASSWORD (legacy).',
      });
    }
    return;
  }

  if (pathname === '/api/sonoff/debug/raw' && req.method === 'GET') {
    const deviceId = String(parsed.query.deviceId || '').trim();
    if (!deviceId) {
      json(res, 400, { error: 'deviceId query is required' });
      return;
    }
    const cfg = getSonoffCfg();
    ewelinkApp
      .debugRawThingAndStatus(cfg, deviceId)
      .then(function (payload) {
        json(res, 200, payload);
      })
      .catch(function (err) {
        json(res, 502, { error: err.message || 'Debug request failed' });
      });
    return;
  }

  if (pathname === '/api/sonoff/relay-mode' && req.method === 'PUT') {
    parseBody(req)
      .then(function (body) {
        const deviceId = String(body.deviceId || '').trim();
        const channel = body.channel == null ? 1 : Number(body.channel);
        const mode = String(body.mode || '').toLowerCase();
        if (!deviceId || !Number.isFinite(channel) || !['automatic', 'manual'].includes(mode)) {
          json(res, 400, { error: 'deviceId, channel(number), mode(automatic/manual) are required' });
          return;
        }
        const doc = readRelayModes();
        doc.modes = doc.modes || {};
        doc.modes[relayModeKey(deviceId, channel)] = mode;
        writeRelayModes(doc);
        json(res, 200, { ok: true, deviceId: deviceId, channel: channel, mode: mode });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/sonoff/control' && req.method === 'POST') {
    parseBody(req)
      .then(function (body) {
        const deviceId = String(body.deviceId || '').trim();
        const state = String(body.state || '').toLowerCase();
        const channel = body.channel == null ? 1 : Number(body.channel);
        const source = String(body.source || 'unknown').toLowerCase();
        const hasPercentage = body && body.percentage != null && body.percentage !== '';
        const percentage = hasPercentage ? Number(body.percentage) : null;
        if (!deviceId || !['on', 'off', 'toggle'].includes(state) || !Number.isFinite(channel)) {
          json(res, 400, { error: 'deviceId, state(on/off/toggle), channel(number) are required' });
          return;
        }
        if (hasPercentage && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
          json(res, 400, { error: 'percentage must be a number between 0 and 100' });
          return;
        }
        const mode = getRelayMode(deviceId, channel);
        if (mode === 'manual' && source !== 'manual-override') {
          json(res, 423, {
            error: 'Relay is in Manual mode and locked to Manual Override page',
            mode: mode,
            deviceId: deviceId,
            channel: channel,
          });
          return;
        }
        return controlSonoffCombined(deviceId, state, channel, {
          percentage: hasPercentage ? Math.round(percentage) : null,
          source: source,
        }).then(function (result) {
          logEvent('info', '[sonoff] control success', {
            deviceId, state, channel, source, mode,
            percentage: hasPercentage ? Math.round(percentage) : null,
            result: result || {},
          });
          json(res, 200, { ok: true, mode: mode, result: result || {} });
        });
      })
      .catch(function (err) {
        if (err && err.message && err.message.indexOf('not configured') !== -1) {
          json(res, 400, { error: err.message });
          return;
        }
        logEvent('error', '[sonoff] control failed', err && err.message ? err.message : err);
        json(res, 502, { error: 'Failed to control Sonoff device', details: err && err.message ? err.message : String(err) });
      });
    return;
  }

  if (pathname === '/api/sonoff/vent-move' && req.method === 'POST') {
    parseBody(req)
      .then(function (body) {
        return startVentMoveJob(body).then(function (job) {
          json(res, 200, { ok: true, job: job });
        });
      })
      .catch(function (err) {
        logEvent('error', '[vent-job] start failed', err && err.message ? err.message : err);
        json(res, 400, { error: err && err.message ? err.message : 'Failed to start vent move' });
      });
    return;
  }

  if (pathname === '/api/sonoff/vent-state' && req.method === 'GET') {
    const st = readVentState();
    const job = serializeLiveVentMoveJob();
    json(res, 200, { ok: true, state: st, activeJob: job });
    return;
  }

  if (pathname === '/api/sonoff/vent-state' && req.method === 'PUT') {
    parseBody(req)
      .then(function (body) {
        const patch = {};
        if (body && body.lastKnownPct != null && body.lastKnownPct !== '') patch.lastKnownPct = Number(body.lastKnownPct);
        if (body && body.fullTravelMs != null && body.fullTravelMs !== '') patch.fullTravelMs = Number(body.fullTravelMs);
        const st = writeVentState(patch);
        json(res, 200, { ok: true, state: st });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/ventilation/pid-state' && req.method === 'GET') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
    const targets = resolveVentTargetsSync();
    json(res, 200, {
      ok: true,
      worker: ventilationPidWorker.readState(),
      targets: targets || null,
      ventState: Object.assign({}, readVentState(), { activeJob: serializeLiveVentMoveJob() }),
    });
    return;
  }

  if (pathname === '/api/ventilation/pid-config' && req.method === 'PUT') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    parseBody(req)
      .then(function (body) {
        if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
        const updated = ventilationPidWorker.updateConfig(body || {});
        json(res, 200, { ok: true, worker: updated });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/ventilation/mode' && req.method === 'PUT') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    parseBody(req)
      .then(function (body) {
        if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
        const updated = ventilationPidWorker.setMode(body && body.mode);
        json(res, 200, { ok: true, worker: updated });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/ventilation/manual-target' && req.method === 'PUT') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    parseBody(req)
      .then(function (body) {
        if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
        const updated = ventilationPidWorker.setManualTargetPct(body && body.targetPct);
        json(res, 200, { ok: true, worker: updated });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/ventilation/manual-hold' && req.method === 'PUT') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    parseBody(req)
      .then(function (body) {
        if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
        const updated = ventilationPidWorker.setManualHold(body && body.extendMs);
        json(res, 200, { ok: true, worker: updated });
      })
      .catch(function (err) {
        json(res, 400, { error: err && err.message ? err.message : 'Invalid body' });
      });
    return;
  }

  if (pathname === '/api/ventilation/tick' && req.method === 'POST') {
    if (!authUserFromReq(req)) { unauthorized(res); return; }
    if (!ventilationPidWorker) { json(res, 503, { error: 'PID worker not ready' }); return; }
    Promise.resolve(ventilationPidWorker.runTick())
      .then(function () { json(res, 200, { ok: true, worker: ventilationPidWorker.readState() }); })
      .catch(function (err) { json(res, 500, { error: err && err.message ? err.message : 'Tick failed' }); });
    return;
  }

  serveStatic(req, res, pathname);
});

ensureDbFile();
recoverVentJobFromStateOnBoot();
ensureVentJobWatchdog();
ensureMasterUser();
influxWriter.initInflux(logEvent);
startAranetMqttIngestor();
pollAndStore();
setInterval(pollAndStore, WEATHER_POLL_MS);

ventilationPidWorker = ventilationPid.init({
  dbDir: DB_DIR,
  logEvent: logEvent,
  readClimateStrategy: readClimateStrategy,
  readVentState: function () {
    const st = readVentState();
    return Object.assign({}, st, { activeJob: serializeLiveVentMoveJob() });
  },
  readRelayModes: readRelayModes,
  readWeatherCurrent: readWeatherCurrentForPid,
  readAranetTempC: readIndoorTempForPid,
  resolveVentTargets: resolveVentTargetsSync,
  startVentMoveJob: startVentMoveJob,
  controlSonoffCombined: controlSonoffCombined,
  writeVentilationTemps: influxWriter.writeVentilationTemps,
});
resolveVentTargetsAsync().catch(function () {});
setInterval(function () {
  resolveVentTargetsAsync().catch(function () {});
}, 4 * 60 * 1000);
pollSonoffDevicesToDb();
setInterval(pollSonoffDevicesToDb, SONOFF_DEVICES_POLL_MS);
if (SENSOR_STATION_BASE_URL) {
  pollStationSensorsToDb();
  setInterval(pollStationSensorsToDb, SENSOR_STATION_POLL_MS);
}
ventilationPidWorker.start();

function gracefulShutdown() {
  influxWriter.shutdownInflux().finally(function () {
    process.exit(0);
  });
}
process.once('SIGINT', gracefulShutdown);
process.once('SIGTERM', gracefulShutdown);

server.listen(PORT, function () {
  logEvent('info', 'Server started', {
    url: 'http://localhost:' + PORT,
    appRoot: APP_ROOT,
    staticRoot: ROOT_DIR,
    weatherPollSeconds: WEATHER_POLL_MS / 1000,
    sonoffDevicesPollSeconds: SONOFF_DEVICES_POLL_MS / 1000,
    stationSensorsPollSeconds: SENSOR_STATION_BASE_URL ? SENSOR_STATION_POLL_MS / 1000 : null,
    stationSensorsBase: SENSOR_STATION_BASE_URL || null,
  });
});
