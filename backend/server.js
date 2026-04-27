const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const Ewelink = require('ewelink-api');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3001);
const WEATHER_POLL_MS = 30 * 1000;

const WEATHER_CFG = {
  stationId: process.env.WEATHER_STATION_ID || 'IKOTAY9',
  units: process.env.WEATHER_UNITS || 's',
  apiKey: process.env.WEATHER_API_KEY || '4a09500e731f432b89500e731f532b68',
};

const EWELINK_CFG = {
  email: process.env.EWELINK_EMAIL || '',
  password: process.env.EWELINK_PASSWORD || '',
  region: process.env.EWELINK_REGION || 'eu',
};

const ROOT_DIR = path.resolve(__dirname, '..', 'greenhouse');
const DB_DIR = path.resolve(__dirname, '..', 'db');
const DB_FILE = path.resolve(DB_DIR, 'weather-observations.json');
const USERS_FILE = path.resolve(DB_DIR, 'users.json');
const SESSIONS_FILE = path.resolve(DB_DIR, 'sessions.json');
const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.resolve(LOG_DIR, 'backend.log');

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
  if (level === 'error') console.error(message, details || '');
  else if (level === 'warn') console.warn(message, details || '');
  else console.log(message, details || '');
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

function hasEwelinkCredentials() {
  return Boolean(EWELINK_CFG.email && EWELINK_CFG.password);
}

function getEwelinkClient() {
  return getEwelinkClientForRegion(EWELINK_CFG.region);
}

function getEwelinkClientForRegion(region) {
  if (!hasEwelinkCredentials()) {
    throw new Error('Missing EWELINK_EMAIL or EWELINK_PASSWORD');
  }
  const key = String(region || EWELINK_CFG.region || 'eu').toLowerCase();
  if (!ewelinkClientsByRegion[key]) {
    ewelinkClientsByRegion[key] = new Ewelink({
      email: EWELINK_CFG.email,
      password: EWELINK_CFG.password,
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
  const primary = String(EWELINK_CFG.region || 'eu').toLowerCase();
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

function simplifySonoffDevice(d) {
  const params = d && d.params ? d.params : {};
  const switches = Array.isArray(params.switches)
    ? params.switches.map(function (s) { return { outlet: s.outlet, switch: s.switch }; })
    : null;
  return {
    deviceid: d.deviceid,
    name: d.name || d.deviceid,
    online: Boolean(d.online),
    brand: d.brandName || null,
    productModel: d.productModel || null,
    uiid: d.uiid || null,
    temperature: params.currentTemperature != null ? Number(params.currentTemperature) : null,
    humidity: params.currentHumidity != null ? Number(params.currentHumidity) : null,
    switch: params.switch || null,
    switches: switches,
  };
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  logEvent('info', '[http] request', { method: req.method, pathname, query: parsed.query || {} });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    parseBody(req).then(function (body) {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || password.length < 6) {
        json(res, 400, { error: 'Username required and password min 6 chars' });
        return;
      }
      const usersDb = readUsers();
      const exists = usersDb.users.some(function (u) { return u.username === username; });
      if (exists) {
        json(res, 409, { error: 'Username already exists' });
        return;
      }
      const id = crypto.randomBytes(8).toString('hex');
      const hp = hashPassword(password);
      usersDb.users.push({
        id,
        username,
        passwordHash: hp.hash,
        salt: hp.salt,
        createdAt: new Date().toISOString(),
      });
      writeUsers(usersDb);
      const token = createSession(id);
      json(res, 200, { ok: true, token, user: { id, username } });
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
      const token = createSession(user.id);
      json(res, 200, { ok: true, token, user: { id: user.id, username: user.username } });
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

  if (pathname.indexOf('/api/weather/') === 0) {
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

  if (pathname.indexOf('/api/sonoff/') === 0) {
    const authUser = authUserFromReq(req);
    if (!authUser) {
      unauthorized(res);
      return;
    }
  }

  if (pathname === '/api/sonoff/devices' && req.method === 'GET') {
    try {
      getDevicesWithRegionFallback().then(function (found) {
        const rows = found.devices.map(simplifySonoffDevice);
        json(res, 200, { region: found.region, count: rows.length, devices: rows });
      }).catch(function (err) {
        logEvent('error', '[sonoff] get devices failed', err && err.message ? err.message : err);
        json(res, 502, { error: 'Failed to fetch devices from eWeLink cloud', details: err && err.message ? err.message : String(err) });
      });
    } catch (err) {
      json(res, 400, {
        error: err.message,
        hint: 'Set EWELINK_EMAIL, EWELINK_PASSWORD and EWELINK_REGION (eu/us/cn) in backend environment.',
      });
    }
    return;
  }

  if (pathname === '/api/sonoff/control' && req.method === 'POST') {
    parseBody(req).then(function (body) {
      const deviceId = String(body.deviceId || '').trim();
      const state = String(body.state || '').toLowerCase();
      const channel = body.channel == null ? 1 : Number(body.channel);
      if (!deviceId || !['on', 'off', 'toggle'].includes(state) || !Number.isFinite(channel)) {
        json(res, 400, { error: 'deviceId, state(on/off/toggle), channel(number) are required' });
        return;
      }
      let client;
      try {
        client = getEwelinkClient();
      } catch (err) {
        json(res, 400, {
          error: err.message,
          hint: 'Set EWELINK_EMAIL, EWELINK_PASSWORD and EWELINK_REGION (eu/us/cn) in backend environment.',
        });
        return;
      }
      client.setDevicePowerState(deviceId, state, channel).then(function (result) {
        logEvent('info', '[sonoff] control success', { deviceId, state, channel, result: result || {} });
        json(res, 200, { ok: true, result: result || {} });
      }).catch(function (err) {
        logEvent('error', '[sonoff] control failed', err && err.message ? err.message : err);
        json(res, 502, { error: 'Failed to control Sonoff device' });
      });
    }).catch(function (err) {
      json(res, 400, { error: err.message || 'Bad request' });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

ensureDbFile();
pollAndStore();
setInterval(pollAndStore, WEATHER_POLL_MS);

server.listen(PORT, function () {
  logEvent('info', 'Server started', {
    url: 'http://localhost:' + PORT,
    staticRoot: ROOT_DIR,
    pollSeconds: WEATHER_POLL_MS / 1000,
  });
});
