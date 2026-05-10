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
    ventFullTravelSeconds: 120,
    stepThresholdC: 1,
    stepSizePct: 10,
    stepIntervalSeconds: 60,
    hardCloseDeltaC: 2,
  };
  const VENTILATION_ACCORDION_SECTIONS = [
    { id: 'ventilation-chart', label: 'Chart', defaultOpen: false },
    { id: 'ventilation-status', label: 'Status', defaultOpen: true },
    { id: 'ventilation-configuration', label: 'Configuration', defaultOpen: true },
  ];
  const STRATEGY_CONFIG_STORAGE_KEY = 'climateStrategyConfig.v1';
  let strategyStatusListenerBound = false;
  let strategyStatusTicker = null;
  let ventilationStatusPoll = null;
  let ventilationVentStateFastPoll = null;
  let ventilationPeriodsListenerBound = false;
  let ventilationMotorProgressTimer = null;
  let lastVentilationDisplayModel = null;
  let cachedVentRelayTargets = null;
  let ventExitSafetyBound = false;
  let ventilationTrendChart = null;
  let ventilationTrendRangeHours = 6;
  let ventilationTrendSamples = [];
  let ventilationTrendHistoryHoursLoaded = 0;
  let ventilationTrendHistoryInflightHours = 0;
  const CLIMATE_STRATEGY_PERIODS_KEY = 'climateStrategyPeriods.v1';
  const VENTILATION_PID_STATE_KEY = 'ventilationPidState.v1';
  const VENTILATION_MANUAL_TARGET_KEY = 'ventilationManualTargetPct.v1';
  const VENTILATION_MANUAL_CHANNELS_KEY = 'ventilationManualChannels.v1';
  const VENTILATION_UI_MODE_KEY = 'ventilationUiMode.v1';
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

  function relayModeKey(deviceId, channel) {
    return String(deviceId || '').trim() + ':' + String(Number(channel));
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
    const deadRaw = Number(CONFIG && CONFIG.ventilationPidDeadbandC);
    const deadC = Number.isFinite(deadRaw) && deadRaw >= 0 ? deadRaw : 0.25;
    const eRaw = measured - setpoint;
    const e = Math.abs(eRaw) <= deadC ? 0 : eRaw;
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
    let lightPct = ventilationLightInfluencePct(cfg, sw);
    if (measured <= setpoint + deadC) {
      lightPct = 0;
    }
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
        e: eRaw,
      },
    };
  }

  /**
   * Match climate card: during an active backend vent job, estimate current % from pulse vs full travel
   * (lastKnownPct is only updated when the move completes).
   */
  function computeVentActualFromBackend(st, job) {
    const fromPct =
      st && Number.isFinite(Number(st.lastKnownPct))
        ? Math.max(0, Math.min(100, Number(st.lastKnownPct)))
        : null;
    const fullTravelMs =
      st && Number.isFinite(Number(st.fullTravelMs))
        ? Math.max(30000, Math.min(2 * 60 * 60 * 1000, Number(st.fullTravelMs)))
        : 120000;
    let actual = fromPct;
    if (
      job &&
      Number.isFinite(Date.parse(String(job.startedAt || ''))) &&
      Number.isFinite(Date.parse(String(job.stopAt || '')))
    ) {
      const startMs = Date.parse(String(job.startedAt));
      const stopMs = Date.parse(String(job.stopAt));
      const now = Date.now();
      const progress = stopMs > startMs ? Math.max(0, Math.min(1, (now - startMs) / (stopMs - startMs))) : 1;
      const pulseMs = Number(job.pulseMs) || Math.max(0, stopMs - startMs);
      const deltaPct = Math.max(0, Math.min(100, (pulseMs / fullTravelMs) * 100));
      const dir = String(job.direction || '').toLowerCase();
      if (actual == null) actual = 0;
      if (dir === 'open') actual = Math.min(100, actual + deltaPct * progress);
      else if (dir === 'close') actual = Math.max(0, actual - deltaPct * progress);
    }
    const out =
      actual != null && Number.isFinite(Number(actual))
        ? Number(actual)
        : fromPct != null && Number.isFinite(Number(fromPct))
          ? Number(fromPct)
          : null;
    return out;
  }

  function backendVentJobIsRunning(job) {
    return !!(job && typeof job === 'object' && job.stopAt && new Date(job.stopAt).getTime() > Date.now());
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
    let backendVentState = null;
    let backendVentJob = null;
    let ventMode = 'automatic';
    let backendPidLatest = null;
    let backendPidWorker = null;
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
    try {
      if (typeof SonoffAPI !== 'undefined' && typeof SonoffAPI.fetchVentState === 'function') {
        const stRes = await SonoffAPI.fetchVentState();
        backendVentState = stRes && stRes.state ? stRes.state : null;
        backendVentJob = stRes && stRes.activeJob ? stRes.activeJob : null;
      }
    } catch (_e) {
      backendVentState = null;
    }
    try {
      if (
        typeof CONFIG !== 'undefined' &&
        CONFIG.ventilationServerPidEnabled === true &&
        typeof SonoffAPI !== 'undefined' &&
        typeof SonoffAPI.fetchVentilationPidState === 'function'
      ) {
        const pidRes = await SonoffAPI.fetchVentilationPidState();
        backendPidWorker = pidRes && pidRes.worker ? pidRes.worker : null;
        backendPidLatest = backendPidWorker && backendPidWorker.latest ? backendPidWorker.latest : null;
      }
    } catch (_e) {
      backendPidLatest = null;
      backendPidWorker = null;
    }
    try {
      if (
        typeof SonoffAPI !== 'undefined' &&
        typeof SonoffAPI.fetchRelayDevicesWithStatus === 'function'
      ) {
        const relayRes = await SonoffAPI.fetchRelayDevicesWithStatus();
        const relayModes = relayRes && relayRes.relayModes ? relayRes.relayModes : {};
        const targets = await resolveVentRelayTargets();
        if (targets && targets.openId && targets.closeId) {
          const openMode = String(relayModes[relayModeKey(targets.openId, targets.openCh)] || '').toLowerCase();
          const closeMode = String(relayModes[relayModeKey(targets.closeId, targets.closeCh)] || '').toLowerCase();
          ventMode = (openMode === 'manual' || closeMode === 'manual') ? 'manual' : 'automatic';
        }
      }
    } catch (_e) {
      ventMode = 'automatic';
    }
    const merged = Object.assign({}, base, {
      currentPeriod:
        derived.periodHuman != null && derived.periodHuman !== '—' ? derived.periodHuman : base.currentPeriod,
      calculatedCoolingTempC:
        derived.coolingC != null ? derived.coolingC : base.calculatedCoolingTempC,
      measuredCoolingTempC: measured != null ? measured : base.measuredCoolingTempC,
    });
    if (
      backendVentState &&
      Number.isFinite(Number(backendVentState.lastKnownPct)) &&
      merged.vents &&
      merged.vents[0]
    ) {
      const interp = computeVentActualFromBackend(backendVentState, backendVentJob);
      const actualPct =
        interp != null && Number.isFinite(interp)
          ? Math.max(0, Math.min(100, interp))
          : Math.max(0, Math.min(100, Number(backendVentState.lastKnownPct)));
      merged.vents = [
        Object.assign({}, merged.vents[0], {
          actualVentPositionPct: actualPct,
        }),
      ];
    }
    // In automatic mode use backend latest.calculatedVentPositionPct; in manual use manual target (not stale auto %).
    let calculatedVent = 0;
    const actualForManual = merged.vents && merged.vents[0] ? Number(merged.vents[0].actualVentPositionPct) : null;
    const workerManual =
      backendPidWorker &&
      String(backendPidWorker.mode || '').toLowerCase() === 'manual' &&
      Number.isFinite(Number(backendPidWorker.manualTargetPct));
    const uiManual = readVentilationUiMode() === 'manual';
    if (workerManual) {
      calculatedVent = Math.max(0, Math.min(100, Number(backendPidWorker.manualTargetPct)));
    } else if (uiManual) {
      calculatedVent = readVentilationManualTargetPct(
        Number.isFinite(actualForManual) ? actualForManual : 0
      );
    } else if (backendPidLatest && Number.isFinite(Number(backendPidLatest.calculatedVentPositionPct))) {
      calculatedVent = Math.max(0, Math.min(100, Number(backendPidLatest.calculatedVentPositionPct)));
    } else if (merged.vents && merged.vents[0] && Number.isFinite(Number(merged.vents[0].calculatedVentPositionPct))) {
      calculatedVent = Number(merged.vents[0].calculatedVentPositionPct);
    }
    const out = Object.assign({}, merged, {
      coolingRequiredPct: calculatedVent,
      coolingBreakdown: null,
      backendVentJob: backendVentJob,
      ventMode: ventMode,
      ventPidWorkerMode: backendPidWorker ? String(backendPidWorker.mode || '').toLowerCase() : null,
      stepReason: backendPidLatest && backendPidLatest.stepReason ? backendPidLatest.stepReason : null,
    });
    const ventPatch = applyVentilationCalculatedVentFromCooling(out, calculatedVent);
    const display = Object.assign({}, out, ventPatch);
    try {
      if (typeof SonoffAPI !== 'undefined' && typeof SonoffAPI.writeVentilationTemps === 'function') {
        SonoffAPI.writeVentilationTemps({
          measuredTempC: display.measuredCoolingTempC,
          calculatedTempC: display.calculatedCoolingTempC,
          calculatedVentPositionPct:
            display && display.vents && display.vents[0] ? display.vents[0].calculatedVentPositionPct : null,
          actualVentPositionPct:
            display && display.vents && display.vents[0] ? display.vents[0].actualVentPositionPct : null,
          coolingRequiredPct: display.coolingRequiredPct,
          period: display.currentPeriod,
          mode: display.ventMode,
        }).catch(function () {
          /* ignore write errors */
        });
      }
    } catch (_e) {
      /* ignore */
    }
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
    if (body) body.innerHTML = renderVentilationStatusHtml(model);
    const chartBody = document.getElementById('reportBody-ventilation-chart');
    if (chartBody && !chartBody.querySelector('[data-vent-trend-canvas]')) {
      chartBody.innerHTML = renderVentilationChartHtml(model);
    }
    ensureVentilationTrendChart();
  }

  function updateVentilationTrendFromPoll(model) {
    if (!model) return;
    appendVentilationTrendSample(model);
    ensureVentilationTrendChart();
    redrawVentilationTrendChart();
  }

  function stopVentilationVentStateFastPoll() {
    if (ventilationVentStateFastPoll) {
      window.clearInterval(ventilationVentStateFastPoll);
      ventilationVentStateFastPoll = null;
    }
  }

  function stopVentilationStatusPoll() {
    if (ventilationStatusPoll) {
      window.clearInterval(ventilationStatusPoll);
      ventilationStatusPoll = null;
    }
    stopVentilationMotorProgressTimer();
    stopVentilationVentStateFastPoll();
  }

  function tickVentilationVentStateFast() {
    const body = document.getElementById('reportBody-ventilation-status');
    if (!body || !lastVentilationDisplayModel) return;
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.fetchVentState !== 'function') return;
    SonoffAPI.fetchVentState()
      .then(function (res) {
        const st = res && res.state ? res.state : null;
        const job = res && res.activeJob ? res.activeJob : null;
        if (!lastVentilationDisplayModel || !lastVentilationDisplayModel.vents || !lastVentilationDisplayModel.vents[0]) {
          return;
        }
        const interp = computeVentActualFromBackend(st, job);
        if (interp == null || !Number.isFinite(interp)) return;
        const running = backendVentJobIsRunning(job);
        lastVentilationDisplayModel = Object.assign({}, lastVentilationDisplayModel, {
          backendVentJob: running ? job : null,
          vents: [
            Object.assign({}, lastVentilationDisplayModel.vents[0], {
              actualVentPositionPct: Math.max(0, Math.min(100, interp)),
            }),
          ],
        });
        applyVentilationStatusDom(lastVentilationDisplayModel);
      })
      .catch(function () {
        /* ignore */
      });
  }

  function readVentPidState() {
    const def = {
      integral: 0,
      lastErr: null,
      lastComputeMs: 0,
      lastActMs: 0,
      lastZeroCalibrationAtMs: 0,
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
        lastZeroCalibrationAtMs: Number(x.lastZeroCalibrationAtMs) || 0,
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

  function clearStaleVentMotorLockIfNeeded() {
    const st = readVentPidState();
    if (!st.ventMotorBusy) return false;
    const now = Date.now();
    const startMs = Number(st.ventMotorStartMs) || 0;
    const endMs = Number(st.ventMotorPulseEndMs) || 0;
    const invalidShape = !(startMs > 0 && endMs > startMs);
    const timedOut = endMs > 0 && now > endMs + 5000;
    if (!invalidShape && !timedOut) return false;
    writeVentPidState({
      ventMotorBusy: false,
      ventMotorTargetActualPct: null,
      ventMotorPulseEndMs: 0,
      ventMotorStartActualPct: null,
      ventMotorStartMs: 0,
    });
    stopVentilationMotorProgressTimer();
    if (typeof Logger !== 'undefined' && Logger.warn) {
      Logger.warn('[vent] cleared stale motor lock', {
        invalidShape: invalidShape,
        timedOut: timedOut,
        startMs: startMs,
        endMs: endMs,
      });
    }
    return true;
  }

  function clampPct(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
    return Math.max(0, Math.min(100, n));
  }

  function readVentilationManualTargetPct(fallback) {
    try {
      const raw = window.localStorage.getItem(VENTILATION_MANUAL_TARGET_KEY);
      if (raw == null || raw === '') return clampPct(fallback, 0);
      return clampPct(raw, fallback);
    } catch (e) {
      return clampPct(fallback, 0);
    }
  }

  function persistVentilationManualTargetPct(v) {
    try {
      window.localStorage.setItem(VENTILATION_MANUAL_TARGET_KEY, String(clampPct(v, 0)));
    } catch (e) {
      /* ignore */
    }
    try {
      if (
        typeof CONFIG !== 'undefined' &&
        CONFIG.ventilationServerPidEnabled === true &&
        typeof SonoffAPI !== 'undefined' &&
        typeof SonoffAPI.setVentilationManualTarget === 'function'
      ) {
        SonoffAPI.setVentilationManualTarget(clampPct(v, 0)).catch(function () {});
      }
    } catch (_e) { /* ignore */ }
  }

  function readVentilationManualChannels() {
    const out = { openCh: null, closeCh: null };
    try {
      const raw = window.localStorage.getItem(VENTILATION_MANUAL_CHANNELS_KEY);
      if (!raw) return out;
      const o = JSON.parse(raw);
      const openCh = Number(o && o.openCh);
      const closeCh = Number(o && o.closeCh);
      if (Number.isFinite(openCh) && openCh >= 1) out.openCh = Math.round(openCh);
      if (Number.isFinite(closeCh) && closeCh >= 1) out.closeCh = Math.round(closeCh);
      return out;
    } catch (e) {
      return out;
    }
  }

  function persistVentilationManualChannels(openCh, closeCh) {
    try {
      const next = {};
      const o = Number(openCh);
      const c = Number(closeCh);
      if (Number.isFinite(o) && o >= 1) next.openCh = Math.round(o);
      if (Number.isFinite(c) && c >= 1) next.closeCh = Math.round(c);
      window.localStorage.setItem(VENTILATION_MANUAL_CHANNELS_KEY, JSON.stringify(next));
    } catch (e) {
      /* ignore */
    }
  }

  function readVentilationUiMode() {
    try {
      const raw = window.localStorage.getItem(VENTILATION_UI_MODE_KEY);
      const mode = String(raw || '').trim().toLowerCase();
      return mode === 'manual' ? 'manual' : 'automatic';
    } catch (e) {
      return 'automatic';
    }
  }

  function persistVentilationUiMode(mode) {
    const next = String(mode || '').trim().toLowerCase() === 'manual' ? 'manual' : 'automatic';
    try {
      window.localStorage.setItem(VENTILATION_UI_MODE_KEY, next);
    } catch (e) {
      /* ignore */
    }
    try {
      if (
        typeof CONFIG !== 'undefined' &&
        CONFIG.ventilationServerPidEnabled === true &&
        typeof SonoffAPI !== 'undefined' &&
        typeof SonoffAPI.setVentilationMode === 'function'
      ) {
        SonoffAPI.setVentilationMode(next).catch(function () {});
      }
    } catch (_e) { /* ignore */ }
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

  async function resolveVentRelayTargets() {
    const openIdCfg = String(CONFIG.sonoffVentOpenDeviceId || '').trim();
    const closeIdCfg = String(CONFIG.sonoffVentCloseDeviceId || '').trim();
    const manualCh = readVentilationManualChannels();
    if (openIdCfg && closeIdCfg) {
      return {
        openId: openIdCfg,
        closeId: closeIdCfg,
        openCh: manualCh.openCh || Number(CONFIG.sonoffVentOpenChannel) || 1,
        closeCh: manualCh.closeCh || Number(CONFIG.sonoffVentCloseChannel) || 1,
        detected: false,
      };
    }
    if (cachedVentRelayTargets) return cachedVentRelayTargets;
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.fetchRelayDevices !== 'function') {
      throw new Error('Vent open/close device ids not configured');
    }
    const devices = await SonoffAPI.fetchRelayDevices();
    const target = (Array.isArray(devices) ? devices : []).find(function (d) {
      const name = String(d && d.name ? d.name : '').trim();
      const switches = Array.isArray(d && d.switches) ? d.switches : [];
      return name === 'W1_W2_L_MV1' && switches.length >= 2 && d && d.deviceid;
    });
    if (!target) {
      throw new Error('Vent open/close device ids not configured');
    }
    cachedVentRelayTargets = {
      openId: String(target.deviceid),
      closeId: String(target.deviceid),
      openCh: manualCh.openCh || 2,
      closeCh: manualCh.closeCh || 1,
      detected: true,
    };
    if (typeof Logger !== 'undefined' && Logger.info) {
      Logger.info('[vent] relay targets autodetected', {
        deviceId: cachedVentRelayTargets.openId,
        openChannel: cachedVentRelayTargets.openCh,
        closeChannel: cachedVentRelayTargets.closeCh,
      });
    }
    return cachedVentRelayTargets;
  }

  function resolveVentRelayTargetsSync() {
    const manualCh = readVentilationManualChannels();
    const openIdCfg = String(CONFIG.sonoffVentOpenDeviceId || '').trim();
    const closeIdCfg = String(CONFIG.sonoffVentCloseDeviceId || '').trim();
    if (openIdCfg && closeIdCfg) {
      return {
        openId: openIdCfg,
        closeId: closeIdCfg,
        openCh: manualCh.openCh || Number(CONFIG.sonoffVentOpenChannel) || 1,
        closeCh: manualCh.closeCh || Number(CONFIG.sonoffVentCloseChannel) || 1,
      };
    }
    if (cachedVentRelayTargets) {
      return {
        openId: String(cachedVentRelayTargets.openId || '').trim(),
        closeId: String(cachedVentRelayTargets.closeId || '').trim(),
        openCh: Number(cachedVentRelayTargets.openCh) || 1,
        closeCh: Number(cachedVentRelayTargets.closeCh) || 1,
      };
    }
    return null;
  }

  function emergencyStopVentRelaysOnLeave(reason) {
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.controlRelay !== 'function') return;
    const t = resolveVentRelayTargetsSync();
    if (!t || !t.openId || !t.closeId) return;
    const src = String(reason || 'ventilation-page-leave');
    SonoffAPI.controlRelay(t.openId, 'off', t.openCh, src).catch(function () {});
    SonoffAPI.controlRelay(t.closeId, 'off', t.closeCh, src).catch(function () {});
    if (typeof Logger !== 'undefined' && Logger.warn) {
      Logger.warn('[vent] emergency stop on page leave', {
        source: src,
        openDeviceId: t.openId,
        closeDeviceId: t.closeId,
        openChannel: t.openCh,
        closeChannel: t.closeCh,
      });
    }
  }

  function bindVentExitSafetyStop() {
    if (ventExitSafetyBound) return;
    ventExitSafetyBound = true;
    window.addEventListener('pagehide', function () {
      emergencyStopVentRelaysOnLeave('ventilation-pagehide');
    });
    window.addEventListener('beforeunload', function () {
      emergencyStopVentRelaysOnLeave('ventilation-beforeunload');
    });
  }

  async function startVentilationMotorMove(fromActualPct, toActualPct, sourceLabel) {
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.controlRelay !== 'function') {
      return Promise.reject(new Error('Sonoff API unavailable'));
    }
    const targets = await resolveVentRelayTargets();
    const openId = String(targets.openId || '').trim();
    const closeId = String(targets.closeId || '').trim();
    const openCh = Number(targets.openCh) || 1;
    const closeCh = Number(targets.closeCh) || 1;
    const cfg = readVentilationConfig();
    const travelSec = Math.max(30, Math.min(Number(cfg.ventFullTravelSeconds) || 120, 7200));
    const fromPct = clampPct(fromActualPct, 0);
    const toPct = clampPct(toActualPct, fromPct);
    const gap = toPct - fromPct;
    const posDead =
      Number.isFinite(Number(CONFIG.ventilationPidPositionDeadbandPct)) && Number(CONFIG.ventilationPidPositionDeadbandPct) >= 0
        ? Number(CONFIG.ventilationPidPositionDeadbandPct)
        : 2;
    if (Math.abs(gap) <= posDead) {
      return Promise.resolve({ skipped: true });
    }

    const now = Date.now();
    const pulseMs = Math.min(Math.max(Math.round(travelSec * 1000 * (Math.abs(gap) / 100)), 500), 15 * 60 * 1000);
    const source = String(sourceLabel || 'ventilation-manual').toLowerCase();
    const isManualSource = source.indexOf('manual') !== -1;
    const direction = gap > 0 ? 'open' : 'close';
    if (typeof Logger !== 'undefined' && Logger.info) {
      Logger.info('[vent] motor move requested', {
        source: source,
        fromActualPct: fromPct,
        toActualPct: toPct,
        gapPct: gap,
        direction: direction,
        pulseMs: pulseMs,
        openDeviceId: openId,
        closeDeviceId: closeId,
        openChannel: openCh,
        closeChannel: closeCh,
      });
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
      ventMotorTargetActualPct: Math.round(toPct * 100) / 100,
      ventMotorPulseEndMs: now + pulseMs,
      ventMotorStartActualPct: Math.round(fromPct * 100) / 100,
      ventMotorStartMs: now,
      manualHoldUntilMs: isManualSource ? now + pulseMs + 2 * 60 * 1000 : 0,
    });
    if (
      isManualSource &&
      typeof CONFIG !== 'undefined' &&
      CONFIG.ventilationServerPidEnabled === true &&
      typeof SonoffAPI !== 'undefined' &&
      typeof SonoffAPI.setVentilationManualHold === 'function'
    ) {
      SonoffAPI.setVentilationManualHold(pulseMs + 2 * 60 * 1000).catch(function () {});
    }
    ensureVentilationMotorProgressTimer();
    syncVentilationMotorProgressAndUi();
    const localFinalizeTimer = window.setTimeout(function () {
      finalizeVentilationMotorAndPersist(toPct);
    }, pulseMs + 800);
    return SonoffAPI.startVentMove({
      openDeviceId: openId,
      closeDeviceId: closeId,
      openChannel: openCh,
      closeChannel: closeCh,
      direction: direction,
      pulseMs: pulseMs,
      fromPct: fromPct,
      targetPct: toPct,
      fullTravelMs: Math.round(travelSec * 1000),
      source: source,
    }).catch(function (err) {
      window.clearTimeout(localFinalizeTimer);
      clearMotorLock();
      throw err;
    });
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
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.startVentMove !== 'function') return;
    if (readVentilationUiMode() === 'manual') return;
    if (CONFIG.ventilationServerPidEnabled === true) return;

    let targets = resolveVentRelayTargetsSync();
    if (!targets || !targets.openId || !targets.closeId) {
      try {
        targets = await resolveVentRelayTargets();
      } catch (_err) {
        targets = null;
      }
    }
    if (!targets || !String(targets.openId || '').trim() || !String(targets.closeId || '').trim()) return;

    const store = readVentilationStatus();
    const m0 = model && model.vents && model.vents[0];
    const s0 = store && store.vents && store.vents[0];
    const v0 = m0 ? (s0 ? Object.assign({}, s0, { calculatedVentPositionPct: m0.calculatedVentPositionPct }) : m0) : null;
    if (!v0) return;
    const calculated = Number(v0.calculatedVentPositionPct);
    const actual = Number(v0.actualVentPositionPct);
    if (!Number.isFinite(calculated) || !Number.isFinite(actual)) return;
    const gap = calculated - actual;

    const posDead =
      Number.isFinite(Number(CONFIG.ventilationPidPositionDeadbandPct)) && Number(CONFIG.ventilationPidPositionDeadbandPct) >= 0
        ? Number(CONFIG.ventilationPidPositionDeadbandPct)
        : 2;
    const now = Date.now();
    let st = readVentPidState();
    const manualHoldUntil = Number(st.manualHoldUntilMs) || 0;
    if (manualHoldUntil > now) {
      return;
    }

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

    const zeroCalIntervalMs = 10 * 60 * 1000;
    const zeroCalPulseMs = 10 * 1000;
    const nearZero = calculated <= 0.5 && actual <= 0.5;
    if (nearZero) {
      const lastZeroCal = Number(st.lastZeroCalibrationAtMs) || 0;
      if (!lastZeroCal || now - lastZeroCal >= zeroCalIntervalMs) {
        writeVentPidState({
          ventMotorBusy: true,
          ventMotorTargetActualPct: 0,
          ventMotorPulseEndMs: now + zeroCalPulseMs,
          ventMotorStartActualPct: Math.max(0, Math.min(100, actual)),
          ventMotorStartMs: now,
          lastZeroCalibrationAtMs: now,
        });
        ensureVentilationMotorProgressTimer();
        syncVentilationMotorProgressAndUi();
        const finalizeTimer = window.setTimeout(function () {
          finalizeVentilationMotorAndPersist(0);
        }, zeroCalPulseMs + 800);
        SonoffAPI.startVentMove({
          openDeviceId: String(targets.openId || '').trim(),
          closeDeviceId: String(targets.closeId || '').trim(),
          openChannel: Number(targets.openCh) || 1,
          closeChannel: Number(targets.closeCh) || 1,
          direction: 'close',
          pulseMs: zeroCalPulseMs,
          fromPct: Math.max(0, Math.min(100, actual)),
          source: 'ventilation-zero-calibration',
        }).catch(function () {
          window.clearTimeout(finalizeTimer);
          writeVentPidState({
            ventMotorBusy: false,
            ventMotorTargetActualPct: null,
            ventMotorPulseEndMs: 0,
            ventMotorStartActualPct: null,
            ventMotorStartMs: 0,
          });
          stopVentilationMotorProgressTimer();
        });
        return;
      }
    }

    if (Math.abs(gap) <= posDead) return;

    const minDemRaw = Number(CONFIG.ventilationPidMinDemandPct);
    const minDemand = Number.isFinite(minDemRaw) && minDemRaw >= 0 ? minDemRaw : 0;
    if (gap > 0 && calculated < minDemand) {
      return;
    }

    const minBetween =
      Number.isFinite(Number(CONFIG.ventilationPidMinMsBetweenVentMoves)) && Number(CONFIG.ventilationPidMinMsBetweenVentMoves) >= 0
        ? Number(CONFIG.ventilationPidMinMsBetweenVentMoves)
        : 800;
    if (st.lastActMs && now - st.lastActMs < minBetween) return;

    const targetActual = Math.round(calculated * 100) / 100;
    startVentilationMotorMove(actual, targetActual, 'ventilation-pid').catch(function () {});
  }

  function startVentilationStatusPoll() {
    stopVentilationStatusPoll();
    function tick() {
      buildMergedVentilationStatus()
        .then(function (model) {
          lastVentilationDisplayModel = model;
          applyVentilationStatusDom(model);
          updateVentilationTrendFromPoll(model);
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
    stopVentilationVentStateFastPoll();
    tickVentilationVentStateFast();
    ventilationVentStateFastPoll = window.setInterval(tickVentilationVentStateFast, 1000);
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
    const manualTarget = Math.round(readVentilationManualTargetPct(v0.actualVentPositionPct));
    const uiVentMode = readVentilationUiMode();
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
    metrics.push(['Calculated target', escapeHtml(String(state.coolingRequiredPct)) + ' %']);
    if (state.stepReason) {
      metrics.push(['Step status', escapeHtml(String(state.stepReason).replace(/-/g, ' '))]);
    }
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
    const job = state && state.backendVentJob ? state.backendVentJob : null;
    const jobRunning = backendVentJobIsRunning(job);
    const tableRows = [
      { label: 'Calculated vent position', val: pctVent(v0.calculatedVentPositionPct) },
      { label: 'Actual vent position', val: pctVent(v0.actualVentPositionPct) },
      { label: 'Vent type', val: escapeHtml(v0.ventType) },
      { label: 'Vent orientation', val: escapeHtml(v0.ventOrientation) },
      {
        label: 'Vent status',
        val: escapeHtml(
          jobRunning
            ? String(job.direction || '').toLowerCase() === 'close'
              ? 'closing'
              : String(job.direction || '').toLowerCase() === 'open'
                ? 'opening'
                : 'moving'
            : v0.ventStatus
        ),
      },
    ];
    const etaSec = jobRunning ? Math.max(0, Math.ceil((new Date(job.stopAt).getTime() - Date.now()) / 1000)) : 0;
    const backendJobRow = jobRunning
      ? {
          label: 'Backend vent job',
          val: escapeHtml(String(job.direction || 'move')) + ' · ends in ' + escapeHtml(String(etaSec)) + ' s',
        }
      : { label: 'Backend vent job', val: 'idle' };
    tableRows.unshift({ label: 'Vent mode', val: '' });
    tableRows.unshift(backendJobRow);
    const modeIsManual = uiVentMode === 'manual';
    clearStaleVentMotorLockIfNeeded();
    const motorBusy = readVentPidState().ventMotorBusy === true;
    const tbodyHtml = tableRows
      .map(function (r) {
        const isTargetRow = r && r.label === 'Calculated vent position';
        const isModeRow = r && r.label === 'Vent mode';
        const valueCell = isTargetRow
          ? (modeIsManual
              ? '<input type="number" min="0" max="100" step="1" class="weather-config-input vent-config-input-compact" data-vent-calc-input value="' +
                escapeHtml(String(manualTarget)) +
                '" ' + (motorBusy ? 'disabled' : '') + ' />'
              : 'auto · ' + pctVent(v0.calculatedVentPositionPct))
          : isModeRow
          ? '<select class="weather-config-input vent-config-input-compact" data-vent-mode-select>' +
            '<option value="automatic"' + (uiVentMode === 'automatic' ? ' selected' : '') + '>automatic</option>' +
            '<option value="manual"' + (uiVentMode === 'manual' ? ' selected' : '') + '>manual</option>' +
            '</select>'
          : r.val;
        return (
          '<tr>' +
          '<th scope="row" class="vent-status-row-label" title="' +
          escapeHtml(r.label) +
          '">' +
          escapeHtml(r.label) +
          '</th>' +
          '<td>' +
          valueCell +
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
      '<th>Vents</th>' +
      '</tr></thead>' +
      '<tbody>' +
      tbodyHtml +
      '</tbody>' +
      '</table>' +
      '</div>'
    );
  }

  function renderVentilationChartHtml(state) {
    const m = state || cloneVentilationStatusDefault();
    const v0 = m.vents && m.vents[0] ? m.vents[0] : cloneVentilationStatusDefault().vents[0];
    const calcVent = clampPct(v0.calculatedVentPositionPct, 0);
    const actualVent = clampPct(v0.actualVentPositionPct, 0);
    const measured = Number.isFinite(Number(m.measuredCoolingTempC)) ? Number(m.measuredCoolingTempC) : 0;
    const calculated = Number.isFinite(Number(m.calculatedCoolingTempC)) ? Number(m.calculatedCoolingTempC) : 0;
    function pct(n) {
      return (Math.round(Number(n) * 100) / 100).toFixed(2) + ' %';
    }
    function temp(n) {
      return (Math.round(Number(n) * 10) / 10).toFixed(1) + ' °C';
    }
    return (
      '<div class="vent-chart-wrap">' +
      '<div class="vent-chart-metrics">' +
      '<div class="vent-chart-metric"><span>Actual vent</span><b>' + escapeHtml(pct(actualVent)) + '</b></div>' +
      '<div class="vent-chart-metric"><span>Calculated vent</span><b>' + escapeHtml(pct(calcVent)) + '</b></div>' +
      '<div class="vent-chart-metric"><span>Measured temp</span><b>' + escapeHtml(temp(measured)) + '</b></div>' +
      '<div class="vent-chart-metric"><span>Calculated temp</span><b>' + escapeHtml(temp(calculated)) + '</b></div>' +
      '</div>' +
      '<div class="weather-chart-card vent-trend-chart-card">' +
      '<div class="weather-chart-head">' +
      '<div class="weather-chart-head-left">' +
      '<div class="weather-chart-title">Ventilation trend chart</div>' +
      '<div class="chart-timesel" data-vent-chart-range>' +
      '<button class="ts-btn active" data-range="6">6h</button>' +
      '<button class="ts-btn" data-range="24">24h</button>' +
      '<button class="ts-btn" data-range="72">3D</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="weather-chart-canvas-wrap">' +
      '<canvas data-vent-trend-canvas></canvas>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function appendVentilationTrendSample(model) {
    if (!model) return;
    const v0 = model.vents && model.vents[0] ? model.vents[0] : null;
    function pickFinite(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    const sample = {
      at: Date.now(),
      calculatedVent: v0 ? pickFinite(v0.calculatedVentPositionPct) : null,
      actualVent: v0 ? pickFinite(v0.actualVentPositionPct) : null,
      measuredTemp: pickFinite(model.measuredCoolingTempC),
      calculatedTemp: pickFinite(model.calculatedCoolingTempC),
    };
    if (
      sample.calculatedVent == null &&
      sample.actualVent == null &&
      sample.measuredTemp == null &&
      sample.calculatedTemp == null
    ) {
      return;
    }
    const last = ventilationTrendSamples.length ? ventilationTrendSamples[ventilationTrendSamples.length - 1] : null;
    if (last && sample.at - last.at < 15000) {
      ventilationTrendSamples[ventilationTrendSamples.length - 1] = {
        at: sample.at,
        calculatedVent: sample.calculatedVent != null ? sample.calculatedVent : last.calculatedVent,
        actualVent: sample.actualVent != null ? sample.actualVent : last.actualVent,
        measuredTemp: sample.measuredTemp != null ? sample.measuredTemp : last.measuredTemp,
        calculatedTemp: sample.calculatedTemp != null ? sample.calculatedTemp : last.calculatedTemp,
      };
    } else {
      ventilationTrendSamples.push(sample);
    }
    const maxKeepMs = 72 * 60 * 60 * 1000;
    const minTs = sample.at - maxKeepMs;
    ventilationTrendSamples = ventilationTrendSamples.filter(function (s) { return s.at >= minTs; });
  }

  function ensureVentilationTrendChart() {
    if (ventilationTrendChart || typeof Chart === 'undefined') return;
    const canvas = document.querySelector('#reportBody-ventilation-chart [data-vent-trend-canvas]');
    if (!canvas) return;
    ventilationTrendChart = new Chart(canvas, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        elements: { point: { radius: 0 } },
        scales: {
          x: { ticks: { maxTicksLimit: 10 } },
          yPct: { type: 'linear', position: 'left', min: 0, max: 100, title: { display: true, text: '%' } },
          yTemp: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°C' } },
        },
      },
    });
  }

  function redrawVentilationTrendChart() {
    if (!ventilationTrendChart) return;
    const now = Date.now();
    const from = now - ventilationTrendRangeHours * 60 * 60 * 1000;
    const filtered = ventilationTrendSamples.filter(function (s) { return s.at >= from; });
    ventilationTrendChart.data.labels = filtered.map(function (s) {
      const d = new Date(s.at);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    });
    ventilationTrendChart.data.datasets = [
      { label: 'Calculated vent %', data: filtered.map(function (s) { return s.calculatedVent; }), borderColor: '#67a86f', borderWidth: 1.8, tension: 0.3, yAxisID: 'yPct' },
      { label: 'Actual vent %', data: filtered.map(function (s) { return s.actualVent; }), borderColor: '#d39c45', borderWidth: 1.8, tension: 0.3, yAxisID: 'yPct' },
      { label: 'Measured temp °C', data: filtered.map(function (s) { return s.measuredTemp; }), borderColor: '#4da6d6', borderWidth: 1.8, tension: 0.3, yAxisID: 'yTemp' },
      { label: 'Calculated temp °C', data: filtered.map(function (s) { return s.calculatedTemp; }), borderColor: '#2e9e5b', borderWidth: 1.8, tension: 0.3, yAxisID: 'yTemp' },
    ];
    ventilationTrendChart.update();
  }

  function bindVentilationManualControls(root) {
    if (!root) return;
    function setManualMessage(msg, isError) {
      const host = document.getElementById('reportBody-ventilation-status');
      if (host) {
        const el = host.querySelector('[data-vent-manual-msg]');
        if (el) {
          el.textContent = String(msg || '');
          el.style.color = isError ? '#b42318' : '#475467';
          return;
        }
      }
      if (typeof Logger !== 'undefined') {
        if (isError && Logger.warn) Logger.warn(String(msg || ''));
        else if (Logger.info) Logger.info(String(msg || ''));
      }
    }
    function runManualMove() {
      const host = document.getElementById('reportBody-ventilation-status');
      if (!host || !root.contains(host)) return;
      if (readVentilationUiMode() !== 'manual') {
        setManualMessage('Switch Vent mode to manual first.', true);
        return;
      }
      const calcInput = host.querySelector('[data-vent-calc-input]');
      const input = calcInput;
      const raw = input ? input.value : 0;
      const target = Math.round(clampPct(raw, 0));
      persistVentilationManualTargetPct(target);
      if (input) input.value = String(target);

      clearStaleVentMotorLockIfNeeded();
      const st = readVentPidState();
      if (st.ventMotorBusy) {
        setManualMessage('Motor is busy. Wait for current move to finish.', true);
        return;
      }
      const currModel = lastVentilationDisplayModel || readVentilationStatus();
      const v0 = currModel && currModel.vents && currModel.vents[0] ? currModel.vents[0] : cloneVentilationStatusDefault().vents[0];
      const actual = clampPct(v0.actualVentPositionPct, 0);
      if (typeof Logger !== 'undefined' && Logger.action) {
        Logger.action('[vent] manual target submit', {
          targetPct: target,
          actualPct: actual,
          direction: target > actual ? 'open' : target < actual ? 'close' : 'none',
        });
      }

      setManualMessage('Move command sent...', false);
      startVentilationMotorMove(actual, target, 'ventilation-manual')
        .then(function () {
          return buildMergedVentilationStatus();
        })
        .then(function (model) {
          lastVentilationDisplayModel = model;
          applyVentilationStatusDom(model);
          setManualMessage('Move started.', false);
        })
        .catch(function (err) {
          const msg = err && err.message ? err.message : 'Move failed';
          setManualMessage(msg, true);
          if (typeof Logger !== 'undefined' && Logger.error) {
            Logger.error('[vent] manual move failed', { message: msg });
          }
        });
    }
    root.addEventListener('input', function (e) {
      const modeSel = e.target.closest('[data-vent-mode-select]');
      if (modeSel && root.contains(modeSel)) {
        persistVentilationUiMode(modeSel.value);
        buildMergedVentilationStatus()
          .then(function (model) {
            lastVentilationDisplayModel = model;
            applyVentilationStatusDom(model);
          })
          .catch(function () {
            /* ignore */
          });
        return;
      }
      const calcInput = e.target.closest('[data-vent-calc-input]');
      if (calcInput && root.contains(calcInput)) {
        const next = Math.round(clampPct(calcInput.value, 0));
        calcInput.value = String(next);
        persistVentilationManualTargetPct(next);
        return;
      }
    });
    root.addEventListener('keydown', function (e) {
      const input = e.target.closest('[data-vent-calc-input]');
      if (!input || !root.contains(input)) return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      runManualMove();
    });
  }

  function bindVentilationChartControls(root) {
    if (!root) return;
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-vent-chart-range] .ts-btn');
      if (!btn || !root.contains(btn)) return;
      const rangeHost = btn.closest('[data-vent-chart-range]');
      if (!rangeHost) return;
      rangeHost.querySelectorAll('.ts-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      const h = Number(btn.getAttribute('data-range'));
      ventilationTrendRangeHours = Number.isFinite(h) && h > 0 ? h : 6;
      ensureVentilationTrendHistoryLoaded(ventilationTrendRangeHours);
      redrawVentilationTrendChart();
    });
  }

  function mergeVentilationTrendSamples(samples) {
    if (!Array.isArray(samples) || !samples.length) return;
    const map = new Map();
    function bucketKey(at) {
      return Math.floor(Number(at) / 30000) * 30000;
    }
    ventilationTrendSamples.forEach(function (s) {
      if (!s || !Number.isFinite(Number(s.at))) return;
      map.set(bucketKey(s.at), s);
    });
    samples.forEach(function (s) {
      if (!s || !Number.isFinite(Number(s.at))) return;
      const key = bucketKey(s.at);
      const existing = map.get(key);
      const merged = Object.assign({}, existing || {}, {
        at: key,
        calculatedVent: s.calculatedVent != null && Number.isFinite(Number(s.calculatedVent)) ? Number(s.calculatedVent) : (existing ? existing.calculatedVent : null),
        actualVent: s.actualVent != null && Number.isFinite(Number(s.actualVent)) ? Number(s.actualVent) : (existing ? existing.actualVent : null),
        measuredTemp: s.measuredTemp != null && Number.isFinite(Number(s.measuredTemp)) ? Number(s.measuredTemp) : (existing ? existing.measuredTemp : null),
        calculatedTemp: s.calculatedTemp != null && Number.isFinite(Number(s.calculatedTemp)) ? Number(s.calculatedTemp) : (existing ? existing.calculatedTemp : null),
      });
      map.set(key, merged);
    });
    ventilationTrendSamples = Array.from(map.values()).sort(function (a, b) {
      return a.at - b.at;
    });
    const maxKeepMs = 14 * 24 * 60 * 60 * 1000;
    const minTs = Date.now() - maxKeepMs;
    ventilationTrendSamples = ventilationTrendSamples.filter(function (s) { return s.at >= minTs; });
  }

  function ensureVentilationTrendHistoryLoaded(rangeHours) {
    const wantedHours = Number.isFinite(Number(rangeHours)) && Number(rangeHours) > 0 ? Number(rangeHours) : 6;
    if (typeof SonoffAPI === 'undefined' || typeof SonoffAPI.fetchVentilationHistory !== 'function') return;
    if (wantedHours <= ventilationTrendHistoryHoursLoaded) return;
    if (wantedHours <= ventilationTrendHistoryInflightHours) return;
    ventilationTrendHistoryInflightHours = wantedHours;
    SonoffAPI.fetchVentilationHistory(wantedHours)
      .then(function (body) {
        if (body && body.ok === true && Array.isArray(body.samples)) {
          mergeVentilationTrendSamples(body.samples);
          ventilationTrendHistoryHoursLoaded = Math.max(ventilationTrendHistoryHoursLoaded, wantedHours);
          redrawVentilationTrendChart();
        }
      })
      .catch(function () {
        /* ignore */
      })
      .then(function () {
        ventilationTrendHistoryInflightHours = 0;
      });
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
      let stepIntervalSeconds;
      if (Number.isFinite(Number(o.stepIntervalSeconds))) {
        stepIntervalSeconds = Math.max(1, Number(o.stepIntervalSeconds));
      } else if (Number.isFinite(Number(o.stepIntervalMs))) {
        stepIntervalSeconds = Math.max(1, Math.round(Number(o.stepIntervalMs) / 1000));
      } else {
        stepIntervalSeconds = d.stepIntervalSeconds;
      }
      return {
        windowOpeningTimeSeconds,
        ventFullTravelSeconds: pick('ventFullTravelSeconds'),
        stepThresholdC: pick('stepThresholdC'),
        stepSizePct: pick('stepSizePct'),
        stepIntervalSeconds,
        hardCloseDeltaC: pick('hardCloseDeltaC'),
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
    try {
      if (
        typeof CONFIG !== 'undefined' &&
        CONFIG.ventilationServerPidEnabled === true &&
        typeof SonoffAPI !== 'undefined' &&
        typeof SonoffAPI.updateVentilationPidConfig === 'function'
      ) {
        const patch = {
          stepThresholdC: Number(next.stepThresholdC),
          stepSizePct: Number(next.stepSizePct),
          stepIntervalMs: Math.max(1000, Math.round(Number(next.stepIntervalSeconds) * 1000)),
          hardCloseDeltaC: Number(next.hardCloseDeltaC),
        };
        SonoffAPI.updateVentilationPidConfig(patch).catch(function () {});
      }
    } catch (_e) { /* ignore */ }
  }

  function renderVentilationConfigurationHtml(cfg) {
    const w = cfg.windowOpeningTimeSeconds;
    const vfs = cfg.ventFullTravelSeconds;
    const stepC = cfg.stepThresholdC;
    const stepPct = cfg.stepSizePct;
    const stepSec = cfg.stepIntervalSeconds;
    const hardC = cfg.hardCloseDeltaC;
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
      '<legend class="vent-config-pid-legend">Step controller</legend>' +
      '<p class="vent-config-priva-hint">Each tick: if measured \u2212 setpoint &ge; threshold \u2192 step open by step %; if &le; \u2212threshold \u2192 step close. Wait the interval between steps. If &le; \u2212hard-close \u2192 snap to 0\u202f%.</p>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Step threshold (\u00b0C)</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="0" max="20" step="0.1" data-vent-config="stepThresholdC" value="' +
      stepC +
      '" />' +
      '<span class="vent-config-unit">\u00b0C</span>' +
      '</div></div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Step size</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="0.5" max="100" step="0.5" data-vent-config="stepSizePct" value="' +
      stepPct +
      '" />' +
      '<span class="vent-config-unit">%</span>' +
      '</div></div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Step wait interval</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="1" step="1" data-vent-config="stepIntervalSeconds" value="' +
      stepSec +
      '" />' +
      '<span class="vent-config-unit">seconds</span>' +
      '</div></div>' +
      '<div class="weather-config-row">' +
      '<div class="weather-config-label">Hard close delta (\u00b0C)</div>' +
      '<div class="vent-config-field-wrap">' +
      '<input type="number" class="' +
      inp +
      '" min="0" max="20" step="0.1" data-vent-config="hardCloseDeltaC" value="' +
      hardC +
      '" />' +
      '<span class="vent-config-unit">\u00b0C</span>' +
      '</div></div>' +
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
        ventFullTravelSeconds: Math.max(30, readField('ventFullTravelSeconds')),
        stepThresholdC: Math.max(0, Math.min(20, readField('stepThresholdC'))),
        stepSizePct: Math.max(0.5, Math.min(100, readField('stepSizePct'))),
        stepIntervalSeconds: Math.max(1, readField('stepIntervalSeconds')),
        hardCloseDeltaC: Math.max(0, Math.min(20, readField('hardCloseDeltaC'))),
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
        toggleId === 'ventilation-chart'
          ? renderVentilationChartHtml(readVentilationStatus())
          : toggleId === 'ventilation-configuration'
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
    bindVentilationManualControls(root);
    bindVentilationChartControls(root);
    ensureVentilationTrendChart();
    ensureVentilationTrendHistoryLoaded(ventilationTrendRangeHours);
    redrawVentilationTrendChart();
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
      try {
        if (
          typeof CONFIG !== 'undefined' &&
          CONFIG.ventilationServerPidEnabled === true &&
          typeof SonoffAPI !== 'undefined'
        ) {
          if (typeof SonoffAPI.setVentilationMode === 'function') {
            SonoffAPI.setVentilationMode(readVentilationUiMode()).catch(function () {});
          }
          if (typeof SonoffAPI.setVentilationManualTarget === 'function') {
            SonoffAPI.setVentilationManualTarget(readVentilationManualTargetPct(0)).catch(function () {});
          }
          if (typeof SonoffAPI.updateVentilationPidConfig === 'function') {
            persistVentilationConfig(readVentilationConfig());
          }
        }
      } catch (_e) { /* ignore */ }
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
