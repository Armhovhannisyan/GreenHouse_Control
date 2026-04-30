/**
 * eWeLink CoolKit v2 (OAuth + device API) using ewelink-api-next.
 * Legacy email/password path still uses ewelink-api when OAuth is not linked.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let WebAPI = null;
let webApiLoadError = null;

function ensureWebApiLoaded() {
  if (WebAPI) return WebAPI;
  if (webApiLoadError) throw webApiLoadError;
  try {
    // Lazy-load so old Node versions can still run backend without OAuth.
    WebAPI = require('ewelink-api-next').default.WebAPI;
    return WebAPI;
  } catch (err) {
    webApiLoadError = new Error(
      'eWeLink OAuth requires newer Node.js runtime (Node 16+). Please upgrade Node.js to use EWELINK_APP_ID/EWELINK_APP_SECRET flow.'
    );
    throw webApiLoadError;
  }
}

const OAUTH_FILE = path.resolve(__dirname, '..', 'db', 'ewelink-oauth.json');
const PENDING_FILE = path.resolve(__dirname, '..', 'db', 'ewelink-oauth-pending.json');

function readJsonSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_err) {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function loadConfig(env, port) {
  const p = Number(port || env.PORT || 3001);
  return {
    appId: String(env.EWELINK_APP_ID || '').trim(),
    appSecret: String(env.EWELINK_APP_SECRET || '').trim(),
    redirectUrl: String(env.EWELINK_OAUTH_REDIRECT_URL || '').trim() || `http://localhost:${p}/api/sonoff/oauth/callback`,
    email: String(env.EWELINK_EMAIL || '').trim(),
    password: String(env.EWELINK_PASSWORD || '').trim(),
    region: String(env.EWELINK_REGION || 'eu').toLowerCase(),
  };
}

function hasAppCredentials(cfg) {
  return Boolean(cfg.appId && cfg.appSecret);
}

function hasLegacyCredentials(cfg) {
  return Boolean(cfg.email && cfg.password);
}

function readOauth() {
  return readJsonSafe(OAUTH_FILE, null);
}

function writeOauth(payload) {
  writeJson(OAUTH_FILE, payload);
}

function prunePending(pending) {
  const now = Date.now();
  const ttl = 15 * 60 * 1000;
  const states = pending.states || {};
  Object.keys(states).forEach(function (k) {
    const rec = states[k];
    if (!rec || now - (rec.createdAt || 0) > ttl) delete states[k];
  });
  pending.states = states;
}

function readPending() {
  const p = readJsonSafe(PENDING_FILE, { states: {} });
  if (!p.states) p.states = {};
  return p;
}

function writePending(p) {
  prunePending(p);
  writeJson(PENDING_FILE, p);
}

function createWebClient(cfg, region) {
  const WebApiCtor = ensureWebApiLoaded();
  return new WebApiCtor({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    region: region || cfg.region || 'eu',
  });
}

function mapThingToDevice(item) {
  if (!item || (item.itemType !== 1 && item.itemType !== 2)) return null;
  const d = item.itemData || {};
  const params = d.params || {};
  const switches = Array.isArray(params.switches)
    ? params.switches.map(function (s) {
        return { outlet: s.outlet, switch: s.switch };
      })
    : null;
  return {
    deviceid: d.deviceid,
    name: d.name || d.deviceid,
    online: Boolean(d.online),
    brand: d.brandName || null,
    productModel: d.productModel || null,
    uiid: d.extra && d.extra.uiid != null ? d.extra.uiid : d.uiid != null ? d.uiid : null,
    temperature: params.currentTemperature != null ? Number(params.currentTemperature) : null,
    humidity: params.currentHumidity != null ? Number(params.currentHumidity) : null,
    switch: params.switch || null,
    switches: switches,
  };
}

async function enrichDeviceStatus(client, device) {
  if (!device || !device.deviceid || device.online === false) return device;
  const needsTh = device.temperature == null && device.humidity == null;
  const needsSwitch = device.switch == null && !Array.isArray(device.switches);
  if (!needsTh && !needsSwitch) return device;
  try {
    const st = await client.device.getThingStatus({ type: 1, id: device.deviceid });
    const params = st && st.data && st.data.params ? st.data.params : {};
    const out = { ...device };
    if (out.temperature == null) {
      if (params.currentTemperature != null) out.temperature = Number(params.currentTemperature);
      else if (params.temperature != null) out.temperature = Number(params.temperature);
    }
    if (out.humidity == null) {
      if (params.currentHumidity != null) out.humidity = Number(params.currentHumidity);
      else if (params.humidity != null) out.humidity = Number(params.humidity);
    }
    if (out.switch == null && typeof params.switch === 'string') out.switch = params.switch;
    if (!Array.isArray(out.switches) && Array.isArray(params.switches)) {
      out.switches = params.switches.map(function (s) {
        return { outlet: s.outlet, switch: s.switch };
      });
    }
    return out;
  } catch (_err) {
    return device;
  }
}

async function ensureOauthTokenFresh(cfg, oauth) {
  const client = createWebClient(cfg, oauth.region || cfg.region);
  client.at = oauth.data.accessToken;
  client.region = oauth.region || cfg.region;
  client.setUrl(client.region);

  const atExp = Number(oauth.data.atExpiredTime);
  const rtExp = Number(oauth.data.rtExpiredTime);
  const now = Date.now();

  if (Number.isFinite(atExp) && atExp < now && Number.isFinite(rtExp) && rtExp > now) {
    const refreshStatus = await client.user.refreshToken({
      rt: oauth.data.refreshToken,
    });
    if (refreshStatus && refreshStatus.error === 0 && refreshStatus.data) {
      const d = refreshStatus.data;
      const next = {
        status: 200,
        error: 0,
        msg: '',
        data: {
          accessToken: d.at,
          atExpiredTime: now + 2592000000,
          refreshToken: d.rt || oauth.data.refreshToken,
          rtExpiredTime: d.rtExpiredTime || oauth.data.rtExpiredTime,
        },
        region: client.region,
      };
      writeOauth(next);
      return next;
    }
  }
  return oauth;
}

async function getOauthClient(cfg) {
  if (!hasAppCredentials(cfg)) {
    throw new Error('Missing EWELINK_APP_ID or EWELINK_APP_SECRET');
  }
  let oauth = readOauth();
  if (!oauth || !oauth.data || !oauth.data.accessToken) {
    throw new Error(
      'eWeLink is not linked yet. While logged into the dashboard, open GET /api/sonoff/oauth/start (with Authorization: Bearer …) or visit the link from the UI.'
    );
  }
  oauth = await ensureOauthTokenFresh(cfg, oauth);
  const client = createWebClient(cfg, oauth.region || cfg.region);
  client.at = oauth.data.accessToken;
  client.region = oauth.region || cfg.region;
  client.setUrl(client.region);
  return { client, oauth };
}

async function fetchDevicesOAuth(cfg) {
  const { client } = await getOauthClient(cfg);
  let res = await client.device.getAllThingsAllPages({});
  if (!res || res.error !== 0) {
    const msg = res && res.msg ? res.msg : 'Unknown error';
    const code = res && Number.isFinite(res.error) ? res.error : null;
    throw new Error((code != null ? `code ${code}: ` : '') + msg);
  }
  const list = (res.data && res.data.thingList) || [];
  const devices = list.map(mapThingToDevice).filter(Boolean);
  const enriched = [];
  for (let i = 0; i < devices.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    enriched.push(await enrichDeviceStatus(client, devices[i]));
  }
  return { region: client.region, devices: enriched };
}

async function debugRawThingAndStatus(cfg, deviceId) {
  const { client } = await getOauthClient(cfg);
  const all = await client.device.getAllThingsAllPages({});
  const list = (all && all.data && all.data.thingList) || [];
  let thing = null;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const d = item && item.itemData ? item.itemData : {};
    if (String(d.deviceid || '') === String(deviceId || '')) {
      thing = item;
      break;
    }
  }
  let status = null;
  if (deviceId) {
    try {
      status = await client.device.getThingStatus({ type: 1, id: deviceId });
    } catch (_err) {
      status = { error: true };
    }
  }
  return { region: client.region, thing: thing, status: status };
}

async function controlThingOAuth(cfg, deviceId, state, channel) {
  const { client } = await getOauthClient(cfg);
  const ch = channel == null ? 1 : Number(channel);
  if (!Number.isFinite(ch) || ch < 1) {
    throw new Error('Invalid channel');
  }

  let params = {};
  if (ch === 1) {
    if (state === 'toggle') {
      const st = await client.device.getThingStatus({ type: 1, id: deviceId });
      const cur = st && st.data && st.data.params && st.data.params.switch;
      const next = cur === 'on' ? 'off' : 'on';
      params = { switch: next };
    } else {
      params = { switch: state };
    }
  } else {
    const st = await client.device.getThingStatus({ type: 1, id: deviceId });
    const p = (st && st.data && st.data.params) || {};
    const switches = Array.isArray(p.switches) ? p.switches.map(function (s) {
      return { outlet: s.outlet, switch: s.switch };
    }) : [];
    if (!switches.length) {
      throw new Error('Device has no multi-channel switches in status');
    }
    const outlet = ch - 1;
    let found = false;
    for (let i = 0; i < switches.length; i += 1) {
      if (Number(switches[i].outlet) !== outlet) continue;
      found = true;
      if (state === 'toggle') {
        switches[i] = { outlet: outlet, switch: switches[i].switch === 'on' ? 'off' : 'on' };
      } else {
        switches[i] = { outlet: outlet, switch: state };
      }
      break;
    }
    if (!found) {
      throw new Error('Channel/outlet not found on device');
    }
    params = { switches: switches };
  }

  const out = await client.device.setThingStatus({
    type: 1,
    id: deviceId,
    params: params,
  });
  if (out && out.error !== 0) {
    const msg = out.msg || 'Control failed';
    throw new Error(`code ${out.error}: ${msg}`);
  }
  return out;
}

function oauthStart(cfg, userId, logEvent) {
  if (!hasAppCredentials(cfg)) {
    throw new Error('Missing EWELINK_APP_ID or EWELINK_APP_SECRET');
  }
  const state = crypto.randomBytes(16).toString('hex');
  const pending = readPending();
  pending.states[state] = { userId: userId || null, createdAt: Date.now() };
  writePending(pending);

  const client = createWebClient(cfg, cfg.region);
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl: cfg.redirectUrl,
    grantType: 'authorization_code',
    state: state,
  });
  if (logEvent) logEvent('info', '[sonoff] oauth start', { stateLen: state.length });
  return loginUrl;
}

async function oauthCallback(cfg, query, logEvent) {
  const code = query.code ? String(query.code) : '';
  const region = String(query.regin || query.region || 'eu').toLowerCase();
  const state = query.state ? String(query.state) : '';
  if (!code || !state) {
    return { ok: false, message: 'Missing code or state' };
  }
  const pending = readPending();
  const rec = pending.states[state];
  if (!rec || Date.now() - (rec.createdAt || 0) > 15 * 60 * 1000) {
    return { ok: false, message: 'Invalid or expired state. Start OAuth again.' };
  }
  delete pending.states[state];
  writePending(pending);

  const client = createWebClient(cfg, region);
  const tokenRes = await client.oauth.getToken({
    region: region,
    redirectUrl: cfg.redirectUrl,
    code: code,
    grantType: 'authorization_code',
  });
  if (!tokenRes || tokenRes.error !== 0) {
    const msg = tokenRes && tokenRes.msg ? tokenRes.msg : 'Token exchange failed';
    if (logEvent) logEvent('error', '[sonoff] oauth token failed', { msg, error: tokenRes && tokenRes.error });
    return { ok: false, message: msg };
  }
  const toSave = {
    status: 200,
    error: 0,
    msg: '',
    data: tokenRes.data,
    region: region,
  };
  writeOauth(toSave);
  if (logEvent) logEvent('info', '[sonoff] oauth linked', { region: region });
  return { ok: true, message: 'eWeLink account linked successfully. You can close this tab.' };
}

module.exports = {
  loadConfig,
  hasAppCredentials,
  hasLegacyCredentials,
  readOauth,
  fetchDevicesOAuth,
  controlThingOAuth,
  debugRawThingAndStatus,
  oauthStart,
  oauthCallback,
  OAUTH_FILE,
};
