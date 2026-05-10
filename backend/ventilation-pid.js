'use strict';

/**
 * Ventilation step controller (server side).
 *
 * Runs a 30-second tick loop independently of any browser session, so the
 * automatic window opening/closing keeps working when nobody is on the
 * ventilation page.
 *
 * Algorithm (per tick, automatic mode only):
 *   error = measuredIndoorTempC - calculatedCoolingTempC (from strategy period)
 *
 *   1. Hard-close (emergency, no wait):
 *        if error <= -hardCloseDeltaC  →  target = 0 %
 *
 *   2. Step (only after stepIntervalMs since last step):
 *        if error >= +stepThresholdC  and actual < maxVentPct
 *            target = min(maxVentPct, actual + stepSizePct)
 *        else if error <= -stepThresholdC  and actual > 0
 *            target = max(0, actual - stepSizePct)
 *
 *   3. Otherwise keep last target (deadband or still-waiting).
 *
 *   If |target - actual| > positionDeadbandPct and not in manual / manual-hold
 *   → schedule a backend vent move job.
 *
 * Plus a periodic "zero-calibration nudge": when both calculated and actual
 * are at 0 %, every zeroCalIntervalMs pulse close for zeroCalPulseMs to make
 * sure the windows are mechanically fully shut.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  // Step controller knobs (user-tunable).
  stepThresholdC: 1,           // |error| ≥ this triggers a step
  stepSizePct: 10,             // each step adjusts target by this
  stepIntervalMs: 60 * 1000,   // wait this long between steps
  hardCloseDeltaC: 2,          // error ≤ -this snaps target to 0 %
  // Safety / anti-chatter (kept from before, no UI):
  positionDeadbandPct: 2,      // ignore tiny gaps to avoid relay chatter
  minMsBetweenVentMoves: 800,  // hard rate-limit on relay on/off
  // Tick cadence.
  tickIntervalMs: 30 * 1000,
  // Zero-calibration: every 10 min while sealed shut, pulse close for 10 s.
  zeroCalIntervalMs: 10 * 60 * 1000,
  zeroCalPulseMs: 10 * 1000,
};

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function ensureFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          config: DEFAULT_CONFIG,
          state: {
            lastTargetPct: 0,
            lastStepAtMs: 0,
            lastActMs: 0,
            lastComputeMs: 0,
            lastZeroCalibrationAtMs: 0,
          },
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
}

function readDoc(filePath) {
  ensureFile(filePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('bad shape');
    return parsed;
  } catch (_err) {
    return {
      config: Object.assign({}, DEFAULT_CONFIG),
      state: {
        lastTargetPct: 0,
        lastStepAtMs: 0,
        lastActMs: 0,
        lastComputeMs: 0,
        lastZeroCalibrationAtMs: 0,
      },
      mode: 'automatic',
      manualHoldUntilMs: 0,
      manualTargetPct: 0,
      latest: null,
    };
  }
}

function writeDoc(filePath, doc) {
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
}

function patchDoc(filePath, patch) {
  const cur = readDoc(filePath);
  const next = Object.assign({}, cur, patch || {});
  if (patch && patch.config) next.config = Object.assign({}, cur.config || {}, patch.config);
  if (patch && patch.state) next.state = Object.assign({}, cur.state || {}, patch.state);
  writeDoc(filePath, next);
  return next;
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
    return Number.isFinite(v) ? clamp(v, 0, 100) : 100;
  }
  const v = Number(String(p.details.maxVentWind).replace(',', '.'));
  return Number.isFinite(v) ? clamp(v, 0, 100) : 100;
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
  out.periodHuman = pShort;
  const pCurr = periods[curr.periodIdx];
  out.coolingC = extractPeriodCoolingTempC(pCurr);
  out.maxVentPct = extractPeriodMaxVentPct(pCurr, ventOrientation);
  return out;
}

function relayModeKey(deviceId, channel) {
  return String(deviceId || '').trim() + ':' + String(Number(channel));
}

function init(deps) {
  if (!deps || typeof deps !== 'object') throw new Error('init deps required');
  const {
    dbDir,
    logEvent,
    readClimateStrategy,
    readVentState,
    readRelayModes,
    resolveVentTargets,
    startVentMoveJob,
    writeVentilationTemps,
  } = deps;
  const readMeasuredIndoorTempC = deps.readMeasuredIndoorTempC || deps.readAranetTempC;
  if (!dbDir) throw new Error('dbDir required');
  const filePath = path.resolve(dbDir, 'ventilation-pid.json');
  ensureFile(filePath);

  let ticking = false;
  let timer = null;

  function logSafe(level, msg, extra) {
    try {
      if (typeof logEvent === 'function') logEvent(level, msg, extra);
    } catch (_e) {
      /* ignore */
    }
  }

  function readState() {
    return readDoc(filePath);
  }

  function updateConfig(patch) {
    if (!patch || typeof patch !== 'object') return readState();
    const cur = readState();
    const next = Object.assign({}, cur.config || {}, DEFAULT_CONFIG, cur.config || {});
    Object.keys(patch).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) {
        const v = Number(patch[k]);
        if (Number.isFinite(v)) next[k] = v;
      }
    });
    const updated = patchDoc(filePath, { config: next });
    logSafe('info', '[vent-pid] config updated', { config: updated.config });
    return updated;
  }

  function setMode(mode) {
    const m = String(mode || '').toLowerCase() === 'manual' ? 'manual' : 'automatic';
    const updated = patchDoc(filePath, { mode: m });
    logSafe('info', '[vent-pid] mode set', { mode: m });
    return updated;
  }

  function setManualHold(extendMs) {
    const ms = Math.max(0, Number(extendMs) || 0);
    const cur = readState();
    const until = Math.max(Number(cur.manualHoldUntilMs) || 0, Date.now() + ms);
    const updated = patchDoc(filePath, { manualHoldUntilMs: until });
    logSafe('info', '[vent-pid] manual hold extended', { manualHoldUntilMs: until });
    return updated;
  }

  function setManualTargetPct(pct) {
    const v = clamp(Number(pct), 0, 100);
    const updated = patchDoc(filePath, { manualTargetPct: v });
    logSafe('info', '[vent-pid] manual target set', { manualTargetPct: v });
    return updated;
  }

  function effectiveModeFromRelays() {
    try {
      if (typeof readRelayModes !== 'function' || typeof resolveVentTargets !== 'function') return null;
      const targets = resolveVentTargets();
      if (!targets) return null;
      const modes = (readRelayModes() && readRelayModes().modes) || {};
      const o = String(modes[relayModeKey(targets.openId, targets.openCh)] || '').toLowerCase();
      const c = String(modes[relayModeKey(targets.closeId, targets.closeCh)] || '').toLowerCase();
      return o === 'manual' || c === 'manual' ? 'manual' : 'automatic';
    } catch (_e) {
      return null;
    }
  }

  let lastTickSkipReason = null;
  let lastTickSkipLogAtMs = 0;

  function logSkip(reason, extra) {
    if (reason !== lastTickSkipReason || Date.now() - lastTickSkipLogAtMs > 60 * 1000) {
      lastTickSkipReason = reason;
      lastTickSkipLogAtMs = Date.now();
      logSafe('info', '[vent-pid] tick skipped', Object.assign({ reason }, extra || {}));
    }
  }

  async function runTick() {
    if (ticking) {
      logSkip('previous-tick-still-running');
      return null;
    }
    ticking = true;
    try {
      const doc = readState();
      const cfg = Object.assign({}, DEFAULT_CONFIG, doc.config || {});
      const now = Date.now();
      logSafe('info', '[vent-step] tick start', {
        mode: doc.mode,
        lastStepAtMs: doc.state && doc.state.lastStepAtMs,
        lastTargetPct: doc.state && doc.state.lastTargetPct,
      });

      const targets = typeof resolveVentTargets === 'function' ? resolveVentTargets() : null;
      const periods =
        typeof readClimateStrategy === 'function'
          ? (function () {
              try {
                const s = readClimateStrategy();
                return s && Array.isArray(s.periods) ? s.periods : null;
              } catch (_e) {
                return null;
              }
            })()
          : null;
      const ventState = typeof readVentState === 'function' ? readVentState() : { lastKnownPct: 0, activeJob: null };
      const measured = typeof readMeasuredIndoorTempC === 'function' ? readMeasuredIndoorTempC() : null;

      const ventOrient = 'wind';
      const derived = deriveVentilationPeriodCoolingAndLabel(periods, ventOrient);
      const setpoint = derived.coolingC != null ? Number(derived.coolingC) : null;
      const maxVentPct = Number.isFinite(Number(derived.maxVentPct)) ? Number(derived.maxVentPct) : 100;
      const actualVentPct = clamp(Number(ventState.lastKnownPct) || 0, 0, 100);

      // ── Step controller knobs ─────────────────────────────────────────
      const stepThresholdC = clamp(Number(cfg.stepThresholdC), 0, 20);
      const stepSizePct = clamp(Number(cfg.stepSizePct), 0.5, 100);
      const stepIntervalMs = Math.max(1000, Number(cfg.stepIntervalMs) || DEFAULT_CONFIG.stepIntervalMs);
      const hardCloseDeltaC = clamp(Number(cfg.hardCloseDeltaC), 0, 20);
      const posDead = clamp(Number(cfg.positionDeadbandPct), 0, 50);
      const minBetween = Math.max(0, Number(cfg.minMsBetweenVentMoves) || 0);

      const stState = doc.state || {};
      const lastTargetRaw = Number(stState.lastTargetPct);
      let target = Number.isFinite(lastTargetRaw) ? clamp(lastTargetRaw, 0, 100) : actualVentPct;
      let stepReason = null;
      let snappedHardClose = false;

      // Compute new target (only meaningful when in automatic mode + valid inputs).
      if (doc.mode === 'manual') {
        target = clamp(Number(doc.manualTargetPct) || 0, 0, 100);
        stepReason = 'manual-mode';
      } else if (Number.isFinite(setpoint) && Number.isFinite(measured)) {
        const error = measured - setpoint;
        if (error <= -hardCloseDeltaC) {
          target = 0;
          snappedHardClose = true;
          stepReason = 'hard-close';
        } else {
          const lastStepAtMs = Number(stState.lastStepAtMs) || 0;
          const sinceStep = now - lastStepAtMs;
          if (!lastStepAtMs || sinceStep >= stepIntervalMs) {
            if (error >= stepThresholdC && actualVentPct < maxVentPct) {
              target = clamp(actualVentPct + stepSizePct, 0, maxVentPct);
              stepReason = 'step-open';
            } else if (error <= -stepThresholdC && actualVentPct > 0) {
              target = clamp(actualVentPct - stepSizePct, 0, maxVentPct);
              stepReason = 'step-close';
            } else {
              stepReason = 'within-deadband';
            }
          } else {
            stepReason = 'still-waiting';
          }
        }
      } else {
        stepReason = 'inputs-missing';
      }
      // Always cap at max-vent-pct from current period.
      target = clamp(target, 0, Math.max(0, maxVentPct));
      target = Math.round(target * 100) / 100;

      // Persist computed snapshot for the UI / chart.
      patchDoc(filePath, {
        state: { lastComputeMs: now },
        latest: {
          computedAt: now,
          calculatedCoolingTempC: Number.isFinite(setpoint) ? setpoint : null,
          measuredCoolingTempC: Number.isFinite(measured) ? measured : null,
          calculatedVentPositionPct: target,
          actualVentPositionPct: actualVentPct,
          maxVentPct,
          periodHuman: derived.periodHuman,
          stepReason,
          stepError: Number.isFinite(setpoint) && Number.isFinite(measured) ? Number((measured - setpoint).toFixed(2)) : null,
          coolingRequiredPct: target,
        },
      });

      if (typeof writeVentilationTemps === 'function') {
        try {
          const p = writeVentilationTemps({
            measuredTempC: Number.isFinite(measured) ? measured : null,
            calculatedTempC: Number.isFinite(setpoint) ? setpoint : null,
            calculatedVentPositionPct: target,
            actualVentPositionPct: actualVentPct,
            coolingRequiredPct: target,
            period: derived.periodHuman,
            mode: doc.mode === 'manual' ? 'manual' : 'automatic',
          });
          if (p && typeof p.then === 'function') p.catch(function () { /* ignore */ });
        } catch (_e) {
          /* ignore */
        }
      }

      // ── Decide whether to move the relay ──────────────────────────────
      const effectiveMode = doc.mode === 'manual' ? 'manual' : (effectiveModeFromRelays() || 'automatic');
      if (effectiveMode === 'manual') {
        logSkip('effective-mode-manual', { docMode: doc.mode });
        return readState();
      }
      if (Number(doc.manualHoldUntilMs) > now) {
        logSkip('manual-hold', { until: Number(doc.manualHoldUntilMs), now });
        return readState();
      }
      if (ventState.activeJob) {
        logSkip('vent-job-active', { jobId: ventState.activeJob && ventState.activeJob.jobId });
        return readState();
      }
      if (!targets || !targets.openId || !targets.closeId) {
        logSkip('targets-not-resolved', { targets });
        return readState();
      }
      if (!Number.isFinite(setpoint) || !Number.isFinite(measured)) {
        logSkip('inputs-missing', { setpoint, measured });
        return readState();
      }

      const lastActMs = Number(stState.lastActMs) || 0;
      if (lastActMs && now - lastActMs < minBetween) {
        logSkip('rate-limit', { sinceLastActMs: now - lastActMs, minBetween });
        return readState();
      }

      // Zero-calibration nudge while sealed shut.
      const nearZero = target <= 0.5 && actualVentPct <= 0.5;
      if (nearZero) {
        const lastZc = Number(stState.lastZeroCalibrationAtMs) || 0;
        if (!lastZc || now - lastZc >= cfg.zeroCalIntervalMs) {
          patchDoc(filePath, {
            state: { lastZeroCalibrationAtMs: now, lastActMs: now, lastTargetPct: 0 },
          });
          logSafe('info', '[vent-step] zero calibration nudge', {
            pulseMs: cfg.zeroCalPulseMs,
            actualPct: actualVentPct,
          });
          if (typeof startVentMoveJob === 'function') {
            await startVentMoveJob({
              openDeviceId: targets.openId,
              closeDeviceId: targets.closeId,
              openChannel: targets.openCh || 1,
              closeChannel: targets.closeCh || 1,
              direction: 'close',
              pulseMs: cfg.zeroCalPulseMs,
              fromPct: actualVentPct,
              source: 'ventilation-server-zero-calibration',
            }).catch(function (err) {
              logSafe('warn', '[vent-step] zero-cal move failed', { error: err && err.message ? err.message : String(err) });
            });
          }
          return readState();
        }
      }

      const gap = target - actualVentPct;
      if (Math.abs(gap) <= posDead) {
        logSkip('within-position-deadband', { gap, posDead, target, actualVentPct, stepReason });
        return readState();
      }

      // Commit the new step (or hard-close): record lastStepAtMs and lastTargetPct
      // so the next tick respects the wait, and schedule a backend vent move.
      patchDoc(filePath, {
        state: {
          lastActMs: now,
          lastStepAtMs: snappedHardClose || stepReason === 'step-open' || stepReason === 'step-close' ? now : (Number(stState.lastStepAtMs) || 0),
          lastTargetPct: target,
        },
      });
      lastTickSkipReason = null;
      logSafe('info', '[vent-step] move scheduled', {
        from: actualVentPct,
        to: target,
        gap,
        stepReason,
        setpoint,
        measured,
        error: Number((measured - setpoint).toFixed(2)),
        maxVentPct,
        stepThresholdC,
        stepSizePct,
        stepIntervalMs,
        hardCloseDeltaC,
        period: derived.periodHuman,
      });
      if (typeof startVentMoveJob === 'function') {
        await startVentMoveJob({
          openDeviceId: targets.openId,
          closeDeviceId: targets.closeId,
          openChannel: targets.openCh || 1,
          closeChannel: targets.closeCh || 1,
          fromPct: actualVentPct,
          targetPct: target,
          source: 'ventilation-server-step',
        }).catch(function (err) {
          logSafe('warn', '[vent-step] move failed', { error: err && err.message ? err.message : String(err) });
        });
      }
      return readState();
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    const cfg = Object.assign({}, DEFAULT_CONFIG, readState().config || {});
    timer = setInterval(function () {
      runTick().catch(function (err) {
        logSafe('error', '[vent-pid] tick failed', { error: err && err.message ? err.message : String(err) });
      });
    }, Math.max(5000, cfg.tickIntervalMs || DEFAULT_CONFIG.tickIntervalMs));
    logSafe('info', '[vent-pid] worker started', { tickIntervalMs: cfg.tickIntervalMs });
  }

  return {
    readState,
    updateConfig,
    setMode,
    setManualHold,
    setManualTargetPct,
    runTick,
    start,
  };
}

module.exports = {
  init,
  DEFAULT_CONFIG,
};
