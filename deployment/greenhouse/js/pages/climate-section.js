const ClimateSectionPage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const SLUG_TO_SECTION = {
    'climate-strategy': 'Climate strategy',
    temperature: 'Temperature',
    humidity: 'Humidity',
    'mixing-valves': 'Mixing valves',
    'cooling-stages': 'Cooling stages',
    ventilation: 'Ventilation',
    'air-circulation': 'Air circulation',
    curtain: 'Curtain',
    customization: 'Customization',
    'crop-treatment': 'Crop treatment',
  };

  const SECTION_MAP = {
    'Climate strategy': [
      ['Current period', '4'],
      ['Mode', 'Automatic'],
      ['Night strategy', 'Enabled'],
      ['Algorithm', 'Adaptive'],
    ],
    Temperature: [
      ['Heating setpoint', '17 °C'],
      ['Cooling setpoint', '18 °C'],
      ['Pipe temperature', '26 °C'],
      ['Leaf temperature', '16.9 °C'],
    ],
    Humidity: [
      ['Relative humidity', '74 %'],
      ['Absolute humidity', '10.7 g/m³'],
      ['Humidity deficit', '3.8 g/m³'],
      ['Dew point', '12.1 °C'],
    ],
    'Mixing valves': [
      ['Valve command', '39 %'],
      ['Valve status', 'No limits'],
      ['Supply temp', '39 °C'],
      ['Max temp', '49 °C'],
    ],
    'Cooling stages': [
      ['Stage 1', '0 %'],
      ['Stage 2', '0 %'],
      ['Cooling enabled', 'No'],
      ['Cooling source', 'Off'],
    ],
    'Air circulation': [
      ['Fan group A', '100 %'],
      ['Fan group B', '100 %'],
      ['Control target', 'Humidity'],
      ['Status', 'Running'],
    ],
    Curtain: [
      ['Curtain position', '100 %'],
      ['Curtain mode', 'Night'],
      ['Energy screen', 'On'],
      ['Blackout screen', 'Off'],
    ],
    Customization: [
      ['Custom setpoint', 'Off'],
      ['Override heat', '—'],
      ['Override cool', '—'],
      ['Override humidity', '—'],
    ],
    'Crop treatment': [
      ['Treatment status', 'Off'],
      ['Recipe', 'Default'],
      ['Spray schedule', 'Inactive'],
      ['Last action', '—'],
    ],
  };

  function getSectionSlug() {
    const fromBody =
      document.body && document.body.dataset && document.body.dataset.sectionSlug
        ? String(document.body.dataset.sectionSlug).trim()
        : '';
    if (fromBody) return fromBody;
    const path = (window.location.pathname || '').replace(/\\/g, '/').toLowerCase();
    const href = (window.location.href || '').toLowerCase();
    if (path.includes('climate-ventilation') || href.includes('climate-ventilation')) {
      return 'ventilation';
    }
    return '';
  }

  function getSectionName() {
    const slug = getSectionSlug();
    if (slug && SLUG_TO_SECTION[slug]) return SLUG_TO_SECTION[slug];
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    return section && SECTION_MAP[section] ? section : 'Climate strategy';
  }

  const STRATEGY_ACCORDION_SECTIONS = [
    { id: 'chart', label: 'Chart', showInfo: false, defaultOpen: false },
    { id: 'status', label: 'Status', showInfo: true, defaultOpen: false },
    { id: 'settings', label: 'Settings', showInfo: true, defaultOpen: false },
    { id: 'configuration', label: 'Configuration', showInfo: true, defaultOpen: true },
  ];

  const STRATEGY_ACCORDION_STORAGE_KEY = 'climateStrategyAccordion.v1';
  const VENTILATION_ACCORDION_STORAGE_KEY = 'ventilationAccordion.v1';
  const VENTILATION_STATUS_STORAGE_KEY = 'ventilationStatus.v1';
  const VENTILATION_STATUS_DEFAULT = {
    currentPeriod: 'period 1',
    calculatedCoolingTempC: 21,
    measuredCoolingTempC: 19,
    coolingStatus: 'no cooling',
    coolingRequiredPct: 0,
    ventRampLastMs: 0,
    vents: [
      {
        id: 'vent 1',
        calculatedVentPositionPct: 0,
        actualVentPositionPct: 0,
        ventType: 'roof vent',
        ventOrientation: 'wind',
        ventStatus: 'no venting',
      },
    ],
  };

  const VENTILATION_CONFIG_STORAGE_KEY = 'ventilationConfig.v1';
  const VENTILATION_CONFIG_DEFAULT = {
    windowOpeningTimeSeconds: 900,
    coolingPidP: 1,
    coolingPidI: 0,
    coolingPidD: 0,
    coolingLightManualPct: 0,
    coolingLightSolarRefW: 0,
    coolingLightSolarMaxPct: 40,
    coolingWeatherWindRefMs: 0,
    coolingWeatherInfluenceMin: 0.5,
    ventFullTravelSeconds: 120,
  };
  const VENTILATION_ACCORDION_SECTIONS = [
    { id: 'ventilation-status', label: 'Status', defaultOpen: true },
    { id: 'ventilation-configuration', label: 'Configuration', defaultOpen: false },
  ];
  const STRATEGY_CONFIG_STORAGE_KEY = 'climateStrategyConfig.v1';
  let strategyStatusListenerBound = false;
  let strategyStatusTicker = null;
  let ventilationStatusPoll = null;
  let ventilationPeriodsListenerBound = false;
  let ventilationMotorProgressTimer = null;
  let lastVentilationDisplayModel = null;
  const CLIMATE_STRATEGY_PERIODS_KEY = 'climateStrategyPeriods.v1';
  const VENTILATION_PID_STATE_KEY = 'ventilationPidState.v1';
  const RAMPING_TYPE_OPTIONS = [
    { value: 'non-line-ramp', label: 'non line ramp' },
    { value: 'liner-ramp', label: 'liner ramp' },
    { value: 'gradient-curve', label: 'gradient curve' },
  ];

  function readStrategyAccordionState() {
    try {
      const raw = window.localStorage.getItem(STRATEGY_ACCORDION_STORAGE_KEY);
      if (!raw) return {};
      const map = JSON.parse(raw);
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function persistStrategyAccordionExpanded(toggleId, expanded) {
    try {
      const map = readStrategyAccordionState();
      map[toggleId] = Boolean(expanded);
      window.localStorage.setItem(STRATEGY_ACCORDION_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function readVentilationAccordionState() {
    try {
      const raw = window.localStorage.getItem(VENTILATION_ACCORDION_STORAGE_KEY);
      if (!raw) return {};
      const map = JSON.parse(raw);
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function persistVentilationAccordionExpanded(toggleId, expanded) {
    try {
      const map = readVentilationAccordionState();
      map[toggleId] = Boolean(expanded);
      window.localStorage.setItem(VENTILATION_ACCORDION_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cloneVentilationStatusDefault() {
    return JSON.parse(JSON.stringify(VENTILATION_STATUS_DEFAULT));
  }

  function sanitizeVentPatch(v) {
    if (!v || typeof v !== 'object') return {};
    const out = {};
    if (typeof v.id === 'string' && v.id.trim()) out.id = v.id.trim();
    ['calculatedVentPositionPct', 'actualVentPositionPct'].forEach(function (k) {
      const n = Number(v[k]);
      if (Number.isFinite(n)) out[k] = n;
    });
    ['ventType', 'ventOrientation', 'ventStatus'].forEach(function (k) {
      if (typeof v[k] === 'string' && v[k].trim()) out[k] = v[k].trim();
    });
    return out;
  }

  function readVentilationStatus() {
    const base = cloneVentilationStatusDefault();
    try {
      const raw = window.localStorage.getItem(VENTILATION_STATUS_STORAGE_KEY);
      if (!raw) return base;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return base;
      if (typeof o.currentPeriod === 'string' && o.currentPeriod.trim()) base.currentPeriod = o.currentPeriod.trim();
      if (Number.isFinite(Number(o.calculatedCoolingTempC))) base.calculatedCoolingTempC = Number(o.calculatedCoolingTempC);
      if (Number.isFinite(Number(o.measuredCoolingTempC))) base.measuredCoolingTempC = Number(o.measuredCoolingTempC);
      if (typeof o.coolingStatus === 'string' && o.coolingStatus.trim()) base.coolingStatus = o.coolingStatus.trim();
      if (Number.isFinite(Number(o.coolingRequiredPct))) base.coolingRequiredPct = Number(o.coolingRequiredPct);
      if (Number.isFinite(Number(o.ventRampLastMs))) base.ventRampLastMs = Number(o.ventRampLastMs);
      if (Array.isArray(o.vents) && o.vents.length >= 1) {
        base.vents[0] = Object.assign({}, base.vents[0], sanitizeVentPatch(o.vents[0]));
      }
      return base;
    } catch (e) {
      return base;
    }
  }

  function readClimateStrategyPeriodsForVentilation() {
    if (typeof window.ClimateStrategyPeriods !== 'undefined' && typeof window.ClimateStrategyPeriods.getState === 'function') {
      try {
        const st = window.ClimateStrategyPeriods.getState();
        if (Array.isArray(st) && st.length) return st;
      } catch (e) {
        /* ignore */
      }
    }
    try {
      const raw = window.localStorage.getItem(CLIMATE_STRATEGY_PERIODS_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch (e) {
      return null;
    }
  }

  function extractPeriodCoolingTempC(p) {
    if (!p || !p.details || p.details.coolingTemp == null) return null;
    const v = Number(String(p.details.coolingTemp).replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }

  function extractPeriodMaxVentPct(p, ventOrientation) {
    if (!p || !p.details) return 100;
    const o = String(ventOrientation || 'wind').toLowerCase();
    if (o.indexOf('lee') !== -1) {
      const v = Number(String(p.details.maxVentLee).replace(',', '.'));
      return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
    }
    const v = Number(String(p.details.maxVentWind).replace(',', '.'));
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
  }

  function ventilationPeriodHumanFromShort(pShort) {
    const s = String(pShort || '').trim();
    if (!s || s === '—') return '—';
    const tr = /^P(\d+)\s*->\s*P(\d+)$/i.exec(s);
    if (tr) return 'period ' + tr[1] + ' → period ' + tr[2];
    const single = /^P(\d+)$/i.exec(s);
    if (single) return 'period ' + single[1];
    return s;
  }

  function deriveVentilationPeriodCoolingAndLabel(periods, ventOrientation) {
    const out = { periodHuman: null, coolingC: null, maxVentPct: 100 };
    if (!Array.isArray(periods) || !periods.length) return out;
    const sched = [];
    let no = 0;
    periods.forEach(function (p, idx) {
      if (!p || !p.use || !p.startTime) return;
      const startMin = parsePeriodStartMinutes(p.startTime);
      if (startMin == null) return;
      no += 1;
      sched.push({
        startMin,
        no,
        rampMin: parsePeriodRampMinutes(p.rampTime),
        periodIdx: idx,
      });
    });
    if (!sched.length) return out;
    sched.sort(function (a, b) {
      return a.startMin - b.startMin;
    });
    if (sched.length === 1) {
      const only = sched[0];
      const p = periods[only.periodIdx];
      out.periodHuman = 'period ' + only.no;
      out.coolingC = extractPeriodCoolingTempC(p);
      out.maxVentPct = extractPeriodMaxVentPct(p, ventOrientation);
      return out;
    }
    const now = new Date();
    const mod = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let si = sched.length - 1;
    for (let i = 0; i < sched.length; i += 1) {
      if (sched[i].startMin <= mod) si = i;
      else break;
    }
    const curr = sched[si];
    const prev = sched[(si - 1 + sched.length) % sched.length];
    let since = mod - curr.startMin;
    if (since < 0) since += 24 * 60;
    let pShort = 'P' + curr.no;
    if (Number.isFinite(curr.rampMin) && curr.rampMin > 0 && since < curr.rampMin) {
      pShort = 'P' + prev.no + ' -> P' + curr.no;
    }
    out.periodHuman = ventilationPeriodHumanFromShort(pShort);
    const pCurr = periods[curr.periodIdx];
    out.coolingC = extractPeriodCoolingTempC(pCurr);
    out.maxVentPct = extractPeriodMaxVentPct(pCurr, ventOrientation);
    return out;
  }

  function applyVentilationCalculatedVentFromCooling(model, calculatedVentPct) {
    const v0 =
      model.vents && model.vents[0] ? Object.assign({}, model.vents[0]) : cloneVentilationStatusDefault().vents[0];
    const calculated = Math.max(0, Math.min(100, Number(calculatedVentPct) || 0));
    v0.calculatedVentPositionPct = calculated;
    if (!Number.isFinite(Number(v0.actualVentPositionPct))) v0.actualVentPositionPct = 0;
    return {
      vents: [v0],
    };
  }

  function ventilationWeatherInfluenceFromWind(windMs, cfg) {
    const ref = Number(cfg.coolingWeatherWindRefMs);
    if (!Number.isFinite(ref) || ref <= 0) return 1;
    const w = Number(windMs);
    if (!Number.isFinite(w) || w < 0) return 1;
    const lo = Number(cfg.coolingWeatherInfluenceMin);
    const loClamped = Number.isFinite(lo) ? Math.min(1, Math.max(0, lo)) : 0.5;
    const t = Math.min(1, w / ref);
    return 1 - t * (1 - loClamped);
  }

  function ventilationLightInfluencePct(cfg, shortwaveW) {
    let L = Number(cfg.coolingLightManualPct);
    if (!Number.isFinite(L)) L = 0;
    L = Math.max(0, L);
    const ref = Number(cfg.coolingLightSolarRefW);
    const maxSolar = Number(cfg.coolingLightSolarMaxPct);
    if (Number.isFinite(ref) && ref > 0 && shortwaveW != null && Number.isFinite(Number(shortwaveW))) {
      const sw = Number(shortwaveW);
      const ratio = Math.max(0, Math.min(1, sw / ref));
      const cap = Number.isFinite(maxSolar) ? Math.max(0, maxSolar) : 0;
      L += ratio * cap;
    }
    return L;
  }

  function ventilationCoolingStepAndCompute(model, cfg, weatherCurr) {
    const setpoint = Number(model.calculatedCoolingTempC);
    const measured = Number(model.measuredCoolingTempC);
    if (!Number.isFinite(setpoint) || !Number.isFinite(measured)) {
      return { breakdown: null };
    }
    const now = Date.now();
    const st = readVentPidState();
    const e = measured - setpoint;
    let dt = st.lastComputeMs ? (now - st.lastComputeMs) / 1000 : 1;
    dt = Math.min(Math.max(dt, 0.25), 120);
    let integral = st.integral + e * dt;
    integral = Math.max(-20, Math.min(20, integral));
    const dTerm = st.lastErr == null ? 0 : (e - st.lastErr) / dt;
    writeVentPidState({
      integral: integral,
      lastErr: e,
      lastComputeMs: now,
      lastActMs: st.lastActMs,
    });

    const Kp = Number(cfg.coolingPidP);
    const Ki = Number(cfg.coolingPidI);
    const Kd = Number(cfg.coolingPidD);
    const pGain = Number.isFinite(Kp) ? Kp : 1;
    const iGain = Number.isFinite(Ki) ? Ki : 0;
    const dGain = Number.isFinite(Kd) ? Kd : 0;
    const pPct = pGain * e;
    const iPct = iGain * integral;
    const dPct = dGain * dTerm;
    const sw = weatherCurr && weatherCurr.shortwave_radiation;
    const lightPct = ventilationLightInfluencePct(cfg, sw);
    const weatherInfluence = ventilationWeatherInfluenceFromWind(
      weatherCurr && weatherCurr.wind_speed_10m,
      cfg
    );
    const rawSum = lightPct + pPct + iPct + dPct;
    const demandPct = rawSum * weatherInfluence;
    const coolingRequiredPct = Math.max(0, Math.min(100, Math.round(demandPct)));

    return {
      breakdown: {
        lightPct,
        pPct,
        iPct,
        dPct,
        rawSum,
        weatherInfluence,
        coolingRequiredPct,
        demandPct,
        e,
      },
    };
  }

  async function buildMergedVentilationStatus() {
    const base = readVentilationStatus();
    const ventOrient = (base.vents[0] && base.vents[0].ventOrientation) || 'wind';
    const periods = readClimateStrategyPeriodsForVentilation();
    const derived =
      periods && periods.length
        ? deriveVentilationPeriodCoolingAndLabel(periods, ventOrient)
        : { periodHuman: null, coolingC: null, maxVentPct: 100 };
    let measured = null;
    let weatherCurrent = {};
    try {
      const data = await WeatherAPI.fetch();
      weatherCurrent = data.current || {};
      const sensors = await SensorAPI.fetchAll(weatherCurrent);
      if (sensors.climate && sensors.climate.temp != null && Number.isFinite(Number(sensors.climate.temp))) {
        measured = Math.round(Number(sensors.climate.temp) * 10) / 10;
      }
    } catch (e) {
      /* keep measured null → fall back to base */
    }
    const merged = Object.assign({}, base, {
      currentPeriod:
        derived.periodHuman != null && derived.periodHuman !== '—' ? derived.periodHuman : base.currentPeriod,
      calculatedCoolingTempC:
        derived.coolingC != null ? derived.coolingC : base.calculatedCoolingTempC,
      measuredCoolingTempC: measured != null ? measured : base.measuredCoolingTempC,
    });
    const cfg = readVentilationConfig();
    const { breakdown } = ventilationCoolingStepAndCompute(merged, cfg, weatherCurrent);
    const coolingReq = breakdown
      ? breakdown.coolingRequiredPct
      : Number.isFinite(Number(merged.coolingRequiredPct))
        ? Number(merged.coolingRequiredPct)
        : 0;
    const ventCap = Number.isFinite(Number(derived.maxVentPct)) ? derived.maxVentPct : 100;
    const calculatedVent = Math.min(ventCap, Math.max(0, coolingReq));
    const out = Object.assign({}, merged, {
      coolingRequiredPct: breakdown ? breakdown.coolingRequiredPct : merged.coolingRequiredPct,
      coolingBreakdown: breakdown,
    });
    const rampModel = Object.assign({}, out);
    const ventPatch = applyVentilationCalculatedVentFromCooling(rampModel, calculatedVent);
    const display = Object.assign({}, out, ventPatch);
    try {
      const forStore = Object.assign({}, display);
      delete forStore.coolingBreakdown;
      persistVentilationStatusFull(forStore);
    } catch (e) {
      /* ignore */
    }
    return display;
  }

  function applyVentilationStatusDom(model) {
    const body = document.getElementById('reportBody-ventilation-status');
    if (!body) return;
    body.innerHTML = renderVentilationStatusHtml(model);
  }

  function stopVentilationStatusPoll() {
    if (ventilationStatusPoll) {
      window.clearInterval(ventilationStatusPoll);
      ventilationStatusPoll = null;
    }
    stopVentilationMotorProgressTimer();
  }

  function readVentPidState() {
    const def = {
      integral: 0,
      lastErr: null,
      lastComputeMs: 0,
      lastActMs: 0,
      ventMotorBusy: false,
      ventMotorTargetActualPct: null,
      ventMotorPulseEndMs: 0,
      ventMotorStartActualPct: null,
      ventMotorStartMs: 0,
    };
    try {
      const raw = window.localStorage.getItem(VENTILATION_PID_STATE_KEY);
      if (!raw) return def;
      const x = JSON.parse(raw);
      if (!x || typeof x !== 'object') return def;
      const tgt =
        x.ventMotorTargetActualPct != null && Number.isFinite(Number(x.ventMotorTargetActualPct))
          ? Math.max(0, Math.min(100, Number(x.ventMotorTargetActualPct)))
          : null;
      return {
        integral: Number.isFinite(Number(x.integral)) ? Number(x.integral) : 0,
        lastErr: x.lastErr != null && Number.isFinite(Number(x.lastErr)) ? Number(x.lastErr) : null,
        lastComputeMs: Number(x.lastComputeMs) || 0,
        lastActMs: Number(x.lastActMs) || 0,
        ventMotorBusy: x.ventMotorBusy === true,
        ventMotorTargetActualPct: tgt,
        ventMotorPulseEndMs: Number(x.ventMotorPulseEndMs) || 0,
        ventMotorStartActualPct:
          x.ventMotorStartActualPct != null && Number.isFinite(Number(x.ventMotorStartActualPct))
            ? Math.max(0, Math.min(100, Number(x.ventMotorStartActualPct)))
            : null,
        ventMotorStartMs: Number(x.ventMotorStartMs) || 0,
      };
    } catch (e) {
      return def;
    }
  }

  function writeVentPidState(patch) {
    try {
      const cur = readVentPidState();
      window.localStorage.setItem(VENTILATION_PID_STATE_KEY, JSON.stringify(Object.assign({}, cur, patch)));
    } catch (e) {
      /* ignore */
    }
  }

  function stopVentilationMotorProgressTimer() {
    if (ventilationMotorProgressTimer) {
      window.clearInterval(ventilationMotorProgressTimer);
      ventilationMotorProgressTimer = null;
    }
  }

  function syncVentilationMotorProgressAndUi() {
    const st = readVentPidState();
    if (!st.ventMotorBusy) {
      stopVentilationMotorProgressTimer();
      return;
    }
    const startMs = Number(st.ventMotorStartMs) || 0;
    const endMs = Number(st.ventMotorPulseEndMs) || 0;
    const fromPct = Number(st.ventMotorStartActualPct);
    const toPct = Number(st.ventMotorTargetActualPct);
    if (!(startMs > 0 && endMs > startMs && Number.isFinite(fromPct) && Number.isFinite(toPct))) return;
    const now = Date.now();
    const t = Math.max(0, Math.min(1, (now - startMs) / (endMs - startMs)));
    const curr = Math.round((fromPct + (toPct - fromPct) * t) * 100) / 100;
    const base = readVentilationStatus();
    const v = base.vents && base.vents[0] ? Object.assign({}, base.vents[0]) : cloneVentilationStatusDefault().vents[0];
    v.actualVentPositionPct = curr;
    persistVentilationStatusFull(Object.assign({}, base, { vents: [v] }));
    if (lastVentilationDisplayModel && lastVentilationDisplayModel.vents && lastVentilationDisplayModel.vents[0]) {
      lastVentilationDisplayModel = Object.assign({}, lastVentilationDisplayModel, {
        vents: [Object.assign({}, lastVentilationDisplayModel.vents[0], { actualVentPositionPct: curr })],
      });
      applyVentilationStatusDom(lastVentilationDisplayModel);
    }
  }

  function ensureVentilationMotorProgressTimer() {
    if (ventilationMotorProgressTimer) return;
    ventilationMotorProgressTimer = window.setInterval(syncVentilationMotorProgressAndUi, 1000);
  }

  function finalizeVentilationMotorAndPersist(targetActualPct) {
    const t = Math.max(0, Math.min(100, Number(targetActualPct)));
    const rounded = Math.round(t * 100) / 100;
    const base = readVentilationStatus();
    const v = base.vents && base.vents[0] ? Object.assign({}, base.vents[0]) : cloneVentilationStatusDefault().vents[0];
    v.actualVentPositionPct = rounded;
    persistVentilationStatusFull(
      Object.assign({}, base, {
        vents: [v],
        coolingStatus: 'Vent: actual position updated',
      })
    );
    writeVentPidState({
      ventMotorBusy: false,
      ventMotorTargetActualPct: null,
      ventMotorPulseEndMs: 0,
      ventMotorStartActualPct: null,
      ventMotorStartMs: 0,
      lastActMs: Date.now(),
    });
    stopVentilationMotorProgressTimer();
    if (lastVentilationDisplayModel && lastVentilationDisplayModel.vents && lastVentilationDisplayModel.vents[0]) {
      lastVentilationDisplayModel = Object.assign({}, lastVentilationDisplayModel, {
        vents: [Object.assign({}, lastVentilationDisplayModel.vents[0], { actualVentPositionPct: rounded })],
        coolingStatus: 'Vent: actual position updated',
      });
      applyVentilationStatusDom(lastVentilationDisplayModel);
    }
  }

  function persistVentilationStatusFull(next) {
    try {
      window.localStorage.setItem(VENTILATION_STATUS_STORAGE_KEY, JSON.stringify(next));
      try {
        window.dispatchEvent(new CustomEvent('ventilationStatusUpdated'));
      } catch (_e) {
        /* ignore */
      }
    } catch (e) {
      /* ignore */
    }
  }

  async function runVentilationPidTick(model) {
    if (typeof CONFIG === 'undefined' || CONFIG.ventilationPidEnabled !== true) return;
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.controlRelay !== 'function') return;
    const openId = String(CONFIG.sonoffVentOpenDeviceId || '').trim();
    const closeId = String(CONFIG.sonoffVentCloseDeviceId || '').trim();
    if (!openId || !closeId) return;

    const store = readVentilationStatus();
    const m0 = model && model.vents && model.vents[0];
    const s0 = store && store.vents && store.vents[0];
    const v0 = m0 ? (s0 ? Object.assign({}, s0, { calculatedVentPositionPct: m0.calculatedVentPositionPct }) : m0) : null;
    if (!v0) return;
    const calculated = Number(v0.calculatedVentPositionPct);
    const actual = Number(v0.actualVentPositionPct);
    if (!Number.isFinite(calculated) || !Number.isFinite(actual)) return;
    const gap = calculated - actual;

    const cfg = readVentilationConfig();
    const openCh = Number(CONFIG.sonoffVentOpenChannel) || 1;
    const closeCh = Number(CONFIG.sonoffVentCloseChannel) || 1;
    const posDead =
      Number.isFinite(Number(CONFIG.ventilationPidPositionDeadbandPct)) && Number(CONFIG.ventilationPidPositionDeadbandPct) >= 0
        ? Number(CONFIG.ventilationPidPositionDeadbandPct)
        : 2;

    const travelSec = Math.max(30, Math.min(Number(cfg.ventFullTravelSeconds) || 120, 7200));
    const now = Date.now();
    let st = readVentPidState();

    if (st.ventMotorBusy && (!(Number(st.ventMotorPulseEndMs) > 0) || !(Number(st.ventMotorStartMs) > 0))) {
      writeVentPidState({
        ventMotorBusy: false,
        ventMotorTargetActualPct: null,
        ventMotorPulseEndMs: 0,
        ventMotorStartActualPct: null,
        ventMotorStartMs: 0,
      });
      stopVentilationMotorProgressTimer();
      st = readVentPidState();
    }

    if (st.ventMotorBusy && st.ventMotorPulseEndMs > 0 && now > st.ventMotorPulseEndMs + 2500) {
      finalizeVentilationMotorAndPersist(
        st.ventMotorTargetActualPct != null ? st.ventMotorTargetActualPct : calculated
      );
      st = readVentPidState();
    }
    if (st.ventMotorBusy) return;

    if (Math.abs(gap) <= posDead) return;

    const minBetween =
      Number.isFinite(Number(CONFIG.ventilationPidMinMsBetweenVentMoves)) && Number(CONFIG.ventilationPidMinMsBetweenVentMoves) >= 0
        ? Number(CONFIG.ventilationPidMinMsBetweenVentMoves)
        : 800;
    if (st.lastActMs && now - st.lastActMs < minBetween) return;

    const pulseMs = Math.min(Math.max(Math.round(travelSec * 1000 * (Math.abs(gap) / 100)), 500), 15 * 60 * 1000);
    const SRC = 'ventilation-pid';
    const targetActual = Math.round(calculated * 100) / 100;

    function delay(ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, ms);
      });
    }

    function scheduleMotorOff(onDev, onCh) {
      window.setTimeout(function () {
        SonoffAPI.controlRelay(onDev, 'off', onCh, SRC).catch(function () {});
        finalizeVentilationMotorAndPersist(targetActual);
      }, pulseMs);
    }

    function clearMotorLock() {
      writeVentPidState({
        ventMotorBusy: false,
        ventMotorTargetActualPct: null,
        ventMotorPulseEndMs: 0,
        ventMotorStartActualPct: null,
        ventMotorStartMs: 0,
      });
      stopVentilationMotorProgressTimer();
    }

    writeVentPidState({
      ventMotorBusy: true,
      ventMotorTargetActualPct: targetActual,
      ventMotorPulseEndMs: now + pulseMs,
      ventMotorStartActualPct: actual,
      ventMotorStartMs: now,
    });
    ensureVentilationMotorProgressTimer();
    syncVentilationMotorProgressAndUi();

    try {
      if (gap > posDead) {
        SonoffAPI.controlRelay(closeId, 'off', closeCh, SRC)
          .catch(function () {})
          .then(function () {
            return delay(200);
          })
          .then(function () {
            return SonoffAPI.controlRelay(openId, 'on', openCh, SRC);
          })
          .then(function () {
            scheduleMotorOff(openId, openCh);
          })
          .catch(function () {
            clearMotorLock();
          });
        return;
      }
      if (gap < -posDead) {
        SonoffAPI.controlRelay(openId, 'off', openCh, SRC)
          .catch(function () {})
          .then(function () {
            return delay(200);
          })
          .then(function () {
            return SonoffAPI.controlRelay(closeId, 'on', closeCh, SRC);
          })
          .then(function () {
            scheduleMotorOff(closeId, closeCh);
          })
          .catch(function () {
            clearMotorLock();
          });
        return;
      }
    } catch (err) {
      clearMotorLock();
    }
  }

  function startVentilationStatusPoll() {
    stopVentilationStatusPoll();
    function tick() {
      buildMergedVentilationStatus()
        .then(function (model) {
          lastVentilationDisplayModel = model;
          applyVentilationStatusDom(model);
          return runVentilationPidTick(model);
        })
        .catch(function () {
          /* ignore */
        });
    }
    tick();
    const ms =
      typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.pollIntervalMs)) && Number(CONFIG.pollIntervalMs) > 0
        ? Number(CONFIG.pollIntervalMs)
        : 30000;
    ventilationStatusPoll = window.setInterval(tick, ms);
  }

  function renderVentilationStatusHtml(state) {
    const pct = function (n) {
      return (Number.isFinite(Number(n)) ? Number(n) : 0) + ' %';
    };
    const pctVent = function (n) {
      const x = Number(n);
      if (!Number.isFinite(x)) return '0.00 %';
      return (Math.round(x * 100) / 100).toFixed(2) + ' %';
    };
    const v0 = state.vents && state.vents[0] ? state.vents[0] : cloneVentilationStatusDefault().vents[0];
    const fmt1 = function (n) {
      const x = Number(n);
      return Number.isFinite(x) ? String(Math.round(x * 10) / 10) : '\u2014';
    };
    const bd = state.coolingBreakdown;
    const metrics = [
      ['Current period', escapeHtml(state.currentPeriod)],
      ['Calculated cooling temperature', escapeHtml(String(state.calculatedCoolingTempC)) + ' \u00b0C'],
      ['Measured cooling temperature', escapeHtml(String(state.measuredCoolingTempC)) + ' \u00b0C'],
    ];
    if (bd && Number.isFinite(Number(bd.rawSum))) {
      metrics.push(['Light influence', escapeHtml(fmt1(bd.lightPct)) + ' %']);
      metrics.push(['P value', escapeHtml(fmt1(bd.pPct)) + ' %']);
      metrics.push(['I value', escapeHtml(fmt1(bd.iPct)) + ' %']);
      metrics.push(['D value', escapeHtml(fmt1(bd.dPct)) + ' %']);
      metrics.push(['Sum (before weather)', escapeHtml(fmt1(bd.rawSum)) + ' %']);
      metrics.push(['Weather influence', escapeHtml(fmt1(bd.weatherInfluence))]);
    }
    metrics.push(['Cooling status', escapeHtml(state.coolingStatus)]);
    metrics.push(['Cooling required', escapeHtml(String(state.coolingRequiredPct)) + ' %']);
    const summaryHtml = metrics
      .map(function (row) {
        return (
          '<div class="vent-status-metric">' +
          '<div class="vent-status-metric-label">' +
          row[0] +
          '</div>' +
          '<div class="vent-status-metric-value">' +
          row[1] +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    const tableRows = [
      { label: 'Calculated vent position', val: pctVent(v0.calculatedVentPositionPct) },
      { label: 'Actual vent position', val: pctVent(v0.actualVentPositionPct) },
      { label: 'Vent type', val: escapeHtml(v0.ventType) },
      { label: 'Vent orientation', val: escapeHtml(v0.ventOrientation) },
      { label: 'Vent status', val: escapeHtml(v0.ventStatus) },
    ];
    const tbodyHtml = tableRows
      .map(function (r) {
        return (
          '<tr>' +
          '<th scope="row" class="vent-status-row-label" title="' +
          escapeHtml(r.label) +
          '">' +
          escapeHtml(r.label) +
          '</th>' +
          '<td>' +
          r.val +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    return (
      '<div class="vent-status">' +
      '<div class="vent-status-summary">' +
      summaryHtml +
      '</div>' +
      '<table class="vent-status-table">' +
      '<thead><tr>' +
      '<th class="vent-status-th-corner"><span class="vent-status-th-icon" aria-hidden="true">\u21c4</span></th>' +
      '<th>' +
      escapeHtml(v0.id) +
      '</th>' +
      '</tr></thead>' +
      '<tbody>' +
      tbodyHtml +
      '</tbody>' +
      '</table>' +
      '</div>'
    );
  }

  function readVentilationConfig() {
    const d = { ...VENTILATION_CONFIG_DEFAULT };
    try {
      const raw = window.localStorage.getItem(VENTILATION_CONFIG_STORAGE_KEY);
      if (!raw) return d;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return d;
      const pick = function (key) {
        const v = Number(o[key]);
        return Number.isFinite(v) ? v : d[key];
      };
      let windowOpeningTimeSeconds;
      if (Number.isFinite(Number(o.windowOpeningTimeSeconds))) {
        windowOpeningTimeSeconds = Math.max(0, Number(o.windowOpeningTimeSeconds));
      } else if (Number.isFinite(Number(o.windowOperationTimeMinutes))) {
        windowOpeningTimeSeconds = Math.max(0, Math.round(Number(o.windowOperationTimeMinutes) * 60));
      } else {
        windowOpeningTimeSeconds = d.windowOpeningTimeSeconds;
      }
      return {
        windowOpeningTimeSeconds,
        coolingPidP: pick('coolingPidP'),
        coolingPidI: pick('coolingPidI'),
        coolingPidD: pick('coolingPidD'),
        coolingLightManualPct: pick('coolingLightManualPct'),
        coolingLightSolarRefW: pick('coolingLightSolarRefW'),
        coolingLightSolarMaxPct: pick('coolingLightSolarMaxPct'),
        coolingWeatherWindRefMs: pick('coolingWeatherWindRefMs'),
        coolingWeatherInfluenceMin: pick('coolingWeatherInfluenceMin'),
        ventFullTravelSeconds: pick('ventFullTravelSeconds'),
      };
    } catch (e) {
      return d;
    }
  }

  function persistVentilationConfig(next) {
    try {
      window.localStorage.setItem(VENTILATION_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function renderVentilationConfigurationHtml(cfg) {
    const w = cfg.windowOpeningTimeSeconds;
    const p = cfg.coolingPidP;
    const i = cfg.coolingPidI;
    const d = cfg.coolingPidD;
    const lm = cfg.coolingLightManualPct;
    const lsr = cfg.coolingLightSolarRefW;
    const lsm = cfg.coolingLightSolarMaxPct;
    const wref = cfg.coolingWeatherWindRefMs;
    const wmin = cfg.coolingWeatherInfluenceMin;
    const vfs = cfg.ventFullTravelSeconds;
    const inp = 'weather-config-input vent-config-input-compact';
    return (
      '<form class="weather-config-grid" data-ventilation-config-form novalidate>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Window opening time</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="0" step="1" data-vent-config="windowOpeningTimeSeconds" value="' +
      w +
      '" />' +
      '<span class="vent-config-unit">seconds</span>' +
      '</div></div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Vent 0\u2192100% travel time</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="30" step="1" data-vent-config="ventFullTravelSeconds" value="' +
      vfs +
      '" />' +
      '<span class="vent-config-unit">seconds</span>' +
      '</div></div>' +
      '<fieldset class="vent-config-pid-fieldset">' +
      '<legend class="vent-config-pid-legend">Cooling influences (Priva-style)</legend>' +
      '<p class="vent-config-priva-hint">Cooling required = (Light + P + I + D) \u00d7 Weather influence (%).</p>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Light (manual) %</div>' +
      '<input type="number" class="' +
      inp +
      '" min="0" step="any" data-vent-config="coolingLightManualPct" value="' +
      lm +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Light solar ref W/m\u00b2 (0=off)</div>' +
      '<input type="number" class="' +
      inp +
      '" min="0" step="any" data-vent-config="coolingLightSolarRefW" value="' +
      lsr +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Light solar max %</div>' +
      '<input type="number" class="' +
      inp +
      '" min="0" step="any" data-vent-config="coolingLightSolarMaxPct" value="' +
      lsm +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Weather wind ref m/s (0=off)</div>' +
      '<input type="number" class="' +
      inp +
      '" min="0" step="any" data-vent-config="coolingWeatherWindRefMs" value="' +
      wref +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Weather min influence (0\u20131)</div>' +
      '<input type="number" class="' +
      inp +
      '" min="0" max="1" step="any" data-vent-config="coolingWeatherInfluenceMin" value="' +
      wmin +
      '" />' +
      '</div>' +
      '</fieldset>' +
      '<fieldset class="vent-config-pid-fieldset">' +
      '<legend class="vent-config-pid-legend">P / I / D (% contributions)</legend>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">P (proportional)</div>' +
      '<input type="number" class="' +
      inp +
      '" step="any" data-vent-config="coolingPidP" value="' +
      p +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">I (integral)</div>' +
      '<input type="number" class="' +
      inp +
      '" step="any" data-vent-config="coolingPidI" value="' +
      i +
      '" />' +
      '</div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">D (derivative)</div>' +
      '<input type="number" class="' +
      inp +
      '" step="any" data-vent-config="coolingPidD" value="' +
      d +
      '" />' +
      '</div>' +
      '</fieldset>' +
      '</form>'
    );
  }

  function bindVentilationConfigForm(root) {
    const form = root.querySelector('[data-ventilation-config-form]');
    if (!form || !root.contains(form)) return;
    function readField(name) {
      const el = form.querySelector('[data-vent-config="' + name + '"]');
      if (!el) return VENTILATION_CONFIG_DEFAULT[name];
      const v = el.value === '' ? NaN : Number(String(el.value).replace(',', '.'));
      return Number.isFinite(v) ? v : VENTILATION_CONFIG_DEFAULT[name];
    }
    function syncToStorage() {
      persistVentilationConfig({
        windowOpeningTimeSeconds: Math.max(0, readField('windowOpeningTimeSeconds')),
        coolingPidP: readField('coolingPidP'),
        coolingPidI: readField('coolingPidI'),
        coolingPidD: readField('coolingPidD'),
        coolingLightManualPct: Math.max(0, readField('coolingLightManualPct')),
        coolingLightSolarRefW: Math.max(0, readField('coolingLightSolarRefW')),
        coolingLightSolarMaxPct: Math.max(0, readField('coolingLightSolarMaxPct')),
        coolingWeatherWindRefMs: Math.max(0, readField('coolingWeatherWindRefMs')),
        coolingWeatherInfluenceMin: Math.min(1, Math.max(0, readField('coolingWeatherInfluenceMin'))),
        ventFullTravelSeconds: Math.max(30, readField('ventFullTravelSeconds')),
      });
    }
    form.addEventListener('input', syncToStorage);
    form.addEventListener('change', syncToStorage);
  }

  function strategyAccordionPlaceholder() {
    return '<p class="climate-strategy-placeholder">Content for this section will be added later.</p>';
  }

  function parsePeriodStartMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  function parsePeriodRampMinutes(raw) {
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

  function currentPeriodLabelFromState() {
    if (typeof window.ClimateStrategyPeriods === 'undefined' || typeof window.ClimateStrategyPeriods.getState !== 'function') {
      return '—';
    }
    let periods;
    try {
      periods = window.ClimateStrategyPeriods.getState();
    } catch (e) {
      return '—';
    }
    if (!Array.isArray(periods)) return '—';
    const sched = [];
    let no = 0;
    periods.forEach((p) => {
      if (!p || !p.use || !p.startTime) return;
      const startMin = parsePeriodStartMinutes(p.startTime);
      if (startMin == null) return;
      no += 1;
      sched.push({ startMin, no, rampMin: parsePeriodRampMinutes(p.rampTime) });
    });
    if (!sched.length) return '—';
    sched.sort((a, b) => a.startMin - b.startMin);
    if (sched.length === 1) return 'P1';
    const now = new Date();
    const mod = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let idx = sched.length - 1;
    for (let i = 0; i < sched.length; i += 1) {
      if (sched[i].startMin <= mod) idx = i;
      else break;
    }
    const curr = sched[idx];
    const prev = sched[(idx - 1 + sched.length) % sched.length];
    let since = mod - curr.startMin;
    if (since < 0) since += 24 * 60;
    if (Number.isFinite(curr.rampMin) && curr.rampMin > 0 && since < curr.rampMin) {
      return 'P' + prev.no + ' -> P' + curr.no;
    }
    return 'P' + curr.no;
  }

  function renderStrategyStatusSection(root) {
    const host = root.querySelector('[data-accordion-body="status"]');
    if (!host) return;
    const current = currentPeriodLabelFromState();
    host.innerHTML = `
      <div class="weather-status-grid">
        <div class="weather-status-item">
          <div class="weather-status-label">Current period</div>
          <div class="weather-status-value">${current}</div>
        </div>
      </div>
    `;
  }

  function ensureStrategyStatusTicker(root) {
    if (strategyStatusTicker) return;
    strategyStatusTicker = window.setInterval(function () {
      renderStrategyStatusSection(root);
    }, 15000);
  }

  function readStrategyConfig() {
    const fallback = { rampingType: 'liner-ramp' };
    try {
      const raw = window.localStorage.getItem(STRATEGY_CONFIG_STORAGE_KEY);
      if (!raw) return fallback;
      const cfg = JSON.parse(raw);
      const val = cfg && typeof cfg.rampingType === 'string' ? cfg.rampingType : fallback.rampingType;
      const valid = RAMPING_TYPE_OPTIONS.some((o) => o.value === val);
      return { rampingType: valid ? val : fallback.rampingType };
    } catch (e) {
      return fallback;
    }
  }

  function persistStrategyConfig(next) {
    try {
      window.localStorage.setItem(STRATEGY_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function renderStrategyConfiguration(root) {
    const host = root.querySelector('[data-accordion-body="configuration"]');
    if (!host) return;
    const cfg = readStrategyConfig();
    const optionHtml = RAMPING_TYPE_OPTIONS.map((o) =>
      `<option value="${o.value}"${o.value === cfg.rampingType ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    host.innerHTML = `
      <div class="weather-config-grid">
        <div class="weather-config-row">
          <div class="weather-config-label">Ramping Type</div>
          <select class="weather-config-select" data-strategy-config="rampingType">
            ${optionHtml}
          </select>
        </div>
      </div>
    `;
  }

  function strategyAccordionAfterToggle(toggleId, expanded) {
    if (expanded && toggleId === 'strategy-chart') {
      window.requestAnimationFrame(function () {
        if (typeof window.ClimateStrategyChart !== 'undefined' && window.ClimateStrategyChart.resize) {
          window.ClimateStrategyChart.resize();
        }
      });
    }
  }

  function bindStrategyReportToggles(root) {
    root.addEventListener('click', function (e) {
      if (e.target.closest('.cfg-help')) {
        e.stopPropagation();
        return;
      }
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('strategy-') !== 0) return;
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistStrategyAccordionExpanded(id, expanded);
      strategyAccordionAfterToggle(id, expanded);
    });
    root.addEventListener('keydown', function (e) {
      if (e.target.closest('.cfg-help')) return;
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('strategy-') !== 0) return;
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistStrategyAccordionExpanded(id, expanded);
      strategyAccordionAfterToggle(id, expanded);
    });

    root.addEventListener('change', function (e) {
      const sel = e.target.closest('select[data-strategy-config="rampingType"]');
      if (!sel || !root.contains(sel)) return;
      const val = String(sel.value || '');
      if (!RAMPING_TYPE_OPTIONS.some((o) => o.value === val)) return;
      persistStrategyConfig({ rampingType: val });
    });

  }

  function renderClimateStrategyAccordion() {
    const root = document.getElementById('climateSectionGrid');
    if (!root) return;
    const saved = readStrategyAccordionState();
    const blocks = STRATEGY_ACCORDION_SECTIONS.map(function (sec) {
      const toggleId = 'strategy-' + sec.id;
      const bodyId = 'reportBody-' + toggleId;
      const savedVal = saved[toggleId];
      const expanded =
        typeof savedVal === 'boolean' ? savedVal : Boolean(sec.defaultOpen);
      const helpHtml = sec.showInfo
        ? '<span class="cfg-help" tabindex="0" title="Section information" aria-label="About this section">i</span>'
        : '';
      const titleInner = helpHtml
        ? '<span class="climate-strategy-title-text">' + sec.label + '</span>' + helpHtml
        : sec.label;
      const titleClass =
        'weather-report-title weather-report-toggle-title' +
        (sec.showInfo ? ' climate-strategy-report-title--split' : '');
      return (
        '<div class="weather-report-block">' +
        '<div class="' +
        titleClass +
        '" data-report-toggle="' +
        toggleId +
        '" role="button" tabindex="0" aria-expanded="' +
        (expanded ? 'true' : 'false') +
        '">' +
        titleInner +
        '</div>' +
        '<div class="weather-report-body' +
        (expanded ? '' : ' collapsed') +
        '" id="' +
        bodyId +
        '">' +
        '<div data-accordion-body="' +
        sec.id +
        '">' +
        (sec.id === 'settings' || sec.id === 'chart' ? '' : strategyAccordionPlaceholder()) +
        '</div>' +
        '</div>' +
        '</div>'
      );
    });
    root.innerHTML = blocks.join('');
    bindStrategyReportToggles(root);
    if (typeof window.ClimateStrategyPeriods !== 'undefined') {
      const settingsHost = root.querySelector('[data-accordion-body="settings"]');
      if (settingsHost) window.ClimateStrategyPeriods.mount(settingsHost);
    }
    if (typeof window.ClimateStrategyChart !== 'undefined') {
      const chartHost = root.querySelector('[data-accordion-body="chart"]');
      if (chartHost) window.ClimateStrategyChart.mount(chartHost);
      const chartBody = document.getElementById('reportBody-strategy-chart');
      if (
        chartBody &&
        !chartBody.classList.contains('collapsed') &&
        window.ClimateStrategyChart.resize
      ) {
        window.requestAnimationFrame(function () {
          window.ClimateStrategyChart.resize();
        });
      }
    }
    renderStrategyConfiguration(root);
    renderStrategyStatusSection(root);
    ensureStrategyStatusTicker(root);
    if (!strategyStatusListenerBound) {
      strategyStatusListenerBound = true;
      window.addEventListener('climate-strategy-periods-changed', function () {
        renderStrategyStatusSection(root);
      });
    }
  }

  function bindVentilationReportToggles(root) {
    function onToggle(e) {
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('ventilation-') !== 0) return;
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistVentilationAccordionExpanded(id, expanded);
    }
    root.addEventListener('click', onToggle);
    root.addEventListener('keydown', function (e) {
      const t = e.target.closest('[data-report-toggle]');
      if (!t || !root.contains(t)) return;
      const id = t.getAttribute('data-report-toggle');
      if (!id || id.indexOf('ventilation-') !== 0) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const body = document.getElementById('reportBody-' + id);
      if (!body) return;
      body.classList.toggle('collapsed');
      const expanded = !body.classList.contains('collapsed');
      t.setAttribute('aria-expanded', String(expanded));
      persistVentilationAccordionExpanded(id, expanded);
    });
  }

  function renderVentilationAccordion() {
    const root = document.getElementById('climateSectionGrid');
    if (!root) return;
    const saved = readVentilationAccordionState();
    const blocks = VENTILATION_ACCORDION_SECTIONS.map(function (sec) {
      const toggleId = sec.id;
      const bodyId = 'reportBody-' + toggleId;
      const savedVal = saved[toggleId];
      const expanded = typeof savedVal === 'boolean' ? savedVal : Boolean(sec.defaultOpen);
      const bodyInner =
        toggleId === 'ventilation-configuration'
          ? renderVentilationConfigurationHtml(readVentilationConfig())
          : toggleId === 'ventilation-status'
            ? renderVentilationStatusHtml(readVentilationStatus())
            : strategyAccordionPlaceholder();
      return (
        '<div class="weather-report-block">' +
        '<div class="weather-report-title weather-report-toggle-title" data-report-toggle="' +
        toggleId +
        '" role="button" tabindex="0" aria-expanded="' +
        (expanded ? 'true' : 'false') +
        '">' +
        sec.label +
        '</div>' +
        '<div class="weather-report-body' +
        (expanded ? '' : ' collapsed') +
        '" id="' +
        bodyId +
        '">' +
        bodyInner +
        '</div>' +
        '</div>'
      );
    });
    root.innerHTML = blocks.join('');
    bindVentilationReportToggles(root);
    bindVentilationConfigForm(root);
  }

  function renderStatusBar(sectionName) {
    const bar = document.getElementById('climateSectionStatusBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="status-item"><div class="status-dot online"></div><span>Section details</span></div>
      <div class="status-item">Section: <span class="font-mono font-semibold">${sectionName}</span></div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
    `;
  }

  function renderCards(sectionName, weather, sensors) {
    const root = document.getElementById('climateSectionGrid');
    if (!root) return;
    const baseRows = SECTION_MAP[sectionName] || [];
    const temp = weather.temperature_2m ?? 0;
    const hum = weather.relative_humidity_2m ?? 0;
    const wind = weather.wind_speed_10m ?? 0;
    const ctemp = sensors.climate ? sensors.climate.temp : temp;
    const rhIn =
      sensors.climate && sensors.climate.humidity != null && Number.isFinite(Number(sensors.climate.humidity))
        ? Number(sensors.climate.humidity)
        : hum;

    const dynamicRows = [
      ['Outdoor temperature', `${temp} °C`],
      ['Outdoor humidity', `${hum} %`],
      ['Indoor temperature', `${ctemp} °C`],
      ['Indoor humidity', `${rhIn} %`],
      ['Wind speed', `${wind} m/s`],
    ];
    if (sensors.climate && sensors.climate.indoorProbeName) {
      dynamicRows.push(['Indoor probe (eWeLink)', sensors.climate.indoorProbeName]);
    }

    const cards = baseRows.concat(dynamicRows).map(([k, v]) => `
      <section class="climate-box">
        <div class="climate-title">${k}</div>
        <div class="climate-value-panel">${v}</div>
        <div class="climate-kv"><div>Live detail for <b>${sectionName}</b></div></div>
      </section>
    `).join('');

    root.innerHTML = cards;
  }

  async function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    const slug = getSectionSlug();
    const sectionName = getSectionName();
    const titleEl = document.getElementById('climateSectionTitle');
    if (titleEl) titleEl.textContent = sectionName;
    const backBtn = document.querySelector('.climate-section-head a[href="climate.html"]');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = 'climate.html';
        }
      });
    }

    if (slug === 'ventilation') {
      renderStatusBar(sectionName);
      renderVentilationAccordion();
      startVentilationStatusPoll();
      if (!ventilationPeriodsListenerBound) {
        ventilationPeriodsListenerBound = true;
        window.addEventListener('climate-strategy-periods-changed', function () {
          if (getSectionSlug() === 'ventilation') {
            buildMergedVentilationStatus()
              .then(applyVentilationStatusDom)
              .catch(function () {});
          }
        });
      }
      return;
    }

    renderStatusBar(sectionName);

    if (slug === 'climate-strategy') {
      renderClimateStrategyAccordion();
      return;
    }

    let weather = {};
    let sensors = {};
    try {
      const data = await WeatherAPI.fetch();
      weather = data.current || {};
      sensors = await SensorAPI.fetchAll(weather);
    } catch (err) {
      // show defaults when live data is unavailable
    }
    renderCards(sectionName, weather, sensors);
  }

  /**
   * Replace inner HTML of a climate-strategy accordion body (ids: chart, status, settings, configuration).
   */
  function setClimateStrategySectionContent(sectionId, htmlString) {
    const el = document.querySelector('[data-accordion-body="' + sectionId + '"]');
    if (el) el.innerHTML = htmlString;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, setClimateStrategySectionContent };
})();
