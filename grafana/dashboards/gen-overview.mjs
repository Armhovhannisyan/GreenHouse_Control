import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Dashboards match *actual* Influx data: this project often only has
 * measurement `aranet_mqtt`, field `value_str` (JSON payloads, suffix `json_measurements`).
 * Weather / aranet_state / aranet_sensor panels stay empty until the backend writes those measurements.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DS = { type: 'influxdb', uid: 'influx-greenhouse' };
const AGG = '2m';

/** Aranet sensor IDs from your MQTT topic path (edit if yours differ). */
const S = {
  drainage: '501948',
  slabWeight: '501AA0',
  substrate: '6036FB',
};

/**
 * Calendar-day boundaries for plant-load aggregation (00:00–24:00 in a fixed offset from UTC).
 * Set to your greenhouse wall-clock offset east of UTC (e.g. 4 for UTC+4). Use 0 for UTC midnights.
 */
const PLANT_LOAD_DAY_OFFSET_HOURS = 0;

/**
 * When slab / plant-load reading drops by at least this much (kg) from the day's trailing peak,
 * treat it as harvest (e.g. tomato picked) and add that mass back into the daily growth signal.
 * 0.05 kg = 50 g. If your JSON `plantLoadDay` / `weight` is in grams, set this to 50 instead.
 */
const PLANT_LOAD_HARVEST_DROP_THRESHOLD_KG = 0.05;

function tsPanel(id, title, y, w, h, x, flux, overrides = []) {
  return {
    id,
    type: 'timeseries',
    title,
    gridPos: { x, y, w, h },
    datasource: DS,
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: {
          axisBorderShow: false,
          axisCenteredZero: false,
          drawStyle: 'line',
          fillOpacity: 14,
          lineInterpolation: 'smooth',
          lineWidth: 2,
          pointSize: 4,
          showPoints: 'never',
          spanNulls: 3600000,
        },
        mappings: [],
        thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }] },
      },
      overrides,
    },
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true, calcs: ['mean', 'lastNotNull'] },
      tooltip: { mode: 'multi', sort: 'none' },
    },
    targets: [{ datasource: DS, query: flux, refId: 'A' }],
  };
}

function rowPanel(id, title, y) {
  return {
    id,
    type: 'row',
    title,
    gridPos: { x: 0, y, w: 24, h: 1 },
    collapsed: false,
  };
}

function textPanel(id, y) {
  return {
    id,
    type: 'text',
    title: '',
    gridPos: { x: 0, y, w: 24, h: 3 },
    options: {
      mode: 'markdown',
      content:
        '### Why charts were empty\n' +
        'Your bucket **`greenhouse`** currently has data mainly under **`aranet_mqtt`** / **`value_str`** (JSON strings, **`suffix`** = `json_measurements`).\n' +
        'Charts that query **`weather`**, **`aranet_state`**, or **`aranet_sensor`** stay empty until the backend also writes those measurements.\n\n' +
        '**Below:** parsed JSON series for sensors **`' +
        S.drainage +
        '`** (pulses / cumulative), **`' +
        S.slabWeight +
        '`** (weight kg + plant load JSON below), **`' +
        S.substrate +
        '`** (vwc). Edit IDs in `grafana/dashboards/gen-overview.mjs` if your Aranet IDs differ, then run `node gen-overview.mjs` from that folder.',
    },
    pluginVersion: '11.4.0',
  };
}

function tablePanel(id, y) {
  return {
    id,
    type: 'table',
    title: 'Latest MQTT rows (aranet_mqtt / value_str)',
    gridPos: { x: 0, y, w: 24, h: 5 },
    datasource: DS,
    fieldConfig: {
      defaults: { custom: { align: 'auto', cellOptions: { type: 'auto' }, inspect: false } },
      overrides: [],
    },
    options: { cellHeight: 'sm', showHeader: true, footer: { show: false } },
    targets: [
      {
        datasource: DS,
        refId: 'A',
        format: 'table',
        query: `from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "aranet_mqtt")
  |> limit(n: 50)`,
      },
    ],
  };
}

/** Parse one numeric field from JSON in value_str; filter to one sensor. */
function fluxJsonField(sensorId, jsonKey, titleSuffix) {
  return `import "experimental/json"

from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) =>
    r["_measurement"] == "aranet_mqtt"
      and r["_field"] == "value_str"
      and r["suffix"] == "json_measurements"
      and r["sensor"] == "${sensorId}"
  )
  |> map(fn: (r) => {
    j = json.parse(data: bytes(v: r._value))
    return { r with _value: float(v: string(v: j.${jsonKey})), _field: "${jsonKey}_${titleSuffix}" }
  })
  |> filter(fn: (r) => exists r._value)
  |> aggregateWindow(every: ${AGG}, fn: mean, createEmpty: false)
  |> yield(name: "mean")`;
}

function fluxRssiAll() {
  return `import "experimental/json"

from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) =>
    r["_measurement"] == "aranet_mqtt"
      and r["_field"] == "value_str"
      and r["suffix"] == "json_measurements"
  )
  |> map(fn: (r) => {
    j = json.parse(data: bytes(v: r._value))
    return { r with _value: float(v: string(v: j.rssi)), _field: "rssi" }
  })
  |> filter(fn: (r) => exists r._value and r._value > -130.0 and r._value < 0.0)
  |> aggregateWindow(every: ${AGG}, fn: mean, createEmpty: false)
  |> yield(name: "mean")`;
}

function fluxBatteryAll() {
  return `import "experimental/json"

from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) =>
    r["_measurement"] == "aranet_mqtt"
      and r["_field"] == "value_str"
      and r["suffix"] == "json_measurements"
  )
  |> map(fn: (r) => {
    j = json.parse(data: bytes(v: r._value))
    return { r with _value: float(v: string(v: j.battery)), _field: "battery_V" }
  })
  |> filter(fn: (r) => exists r._value and r._value > 0.0 and r._value < 5.0)
  |> aggregateWindow(every: ${AGG}, fn: mean, createEmpty: false)
  |> yield(name: "mean")`;
}

/** Optional: when weather measurement exists — same as before. */
const fluxWeatherTemp = `from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "weather")
  |> filter(fn: (r) => r["_field"] == "temperature_2m" or r["_field"] == "relative_humidity_2m")
  |> aggregateWindow(every: ${AGG}, fn: mean, createEmpty: false)
  |> yield(name: "mean")`;

/**
 * Per local calendar day: one bar = harvest-adjusted change within that day.
 * Walks all samples in chronological order; if reading falls by >= threshold (kg) from the trailing
 * peak, the drop is treated as harvest and added to a running offset so the end-of-day virtual mass
 * is (lastReading + harvestMassRemoved) − firstReading ≈ net plant growth for the day.
 * JSON: `plantLoadDay` / `plant_load_day` / `weight` on sensor `sensorId` (same as slab chart).
 */
function fluxPlantLoadMidnightDeltaPerDay(sensorId, offsetHours) {
  const h = Number(offsetHours);
  const safe = Number.isFinite(h) ? Math.trunc(h) : 0;
  const offsetFlux = `${safe}h`;
  const harvestTh = Number(PLANT_LOAD_HARVEST_DROP_THRESHOLD_KG);
  const th = Number.isFinite(harvestTh) && harvestTh > 0 ? harvestTh : 0.05;
  return `import "experimental/json"
import "date"
import "timezone"

option location = timezone.fixed(offset: ${offsetFlux})

from(bucket: "greenhouse")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) =>
    r["_measurement"] == "aranet_mqtt"
      and r["_field"] == "value_str"
      and r["suffix"] == "json_measurements"
      and r["sensor"] == "${sensorId}"
  )
  |> map(fn: (r) => {
    j = json.parse(data: bytes(v: r._value))
    s =
      if exists j.plantLoadDay then string(v: j.plantLoadDay)
      else if exists j.plant_load_day then string(v: j.plant_load_day)
      else if exists j.weight then string(v: j.weight)
      else ""
    v =
      if s != "" and s != "<nil>" then float(v: s)
      else -1.0
    return { r with _value: v }
  })
  |> filter(fn: (r) => r._value >= 0.0)
  |> map(fn: (r) => ({ r with day: date.truncate(t: r._time, unit: 1d, location: location) }))
  |> group(columns: ["day"])
  |> sort(columns: ["_time"])
  |> reduce(
    identity: {
      i: 0,
      firstV: 0.0,
      lastV: 0.0,
      peak: 0.0,
      sumH: 0.0,
      day: time(v: "1970-01-01T00:00:00Z"),
    },
    fn: (r, acc) => {
      i2 = acc.i + 1
      firstV = if acc.i == 0 then r._value else acc.firstV
      lastV = r._value
      peakNext =
        if acc.i == 0 then
          r._value
        else if r._value > acc.peak then
          r._value
        else if acc.peak - r._value >= ${th} then
          r._value
        else
          acc.peak
      sumHNext =
        if acc.i == 0 then
          0.0
        else if r._value > acc.peak then
          acc.sumH
        else if acc.peak - r._value >= ${th} then
          acc.sumH + (acc.peak - r._value)
        else
          acc.sumH
      dayNext = if acc.i == 0 then r.day else acc.day
      return {
        i: i2,
        firstV: firstV,
        lastV: lastV,
        peak: peakNext,
        sumH: sumHNext,
        day: dayNext,
      }
    },
  )
  |> map(fn: (r) => ({
    _time: r.day,
    _value: r.lastV + r.sumH - r.firstV,
    _field: "daily_delta",
    _measurement: "plant_load_bar",
  }))
  |> yield(name: "plant_load_daily_delta")`;
}

function plantLoadDailyBarChartPanel(id, title, y, w, h, x, flux) {
  return {
    id,
    type: 'barchart',
    title,
    description:
      'Each bar = (last reading + harvest offsets) − first reading **within** that calendar day. A **harvest** is a drop ≥ **' +
      String(PLANT_LOAD_HARVEST_DROP_THRESHOLD_KG) +
      '** (kg) from the trailing peak; that mass is added back so tomato picking does not look like negative growth. JSON: `plantLoadDay` / `plant_load_day`, else **`weight`**. Edit **PLANT_LOAD_HARVEST_DROP_THRESHOLD_KG** in `gen-overview.mjs` (use **50** if values are grams). Set **PLANT_LOAD_DAY_OFFSET_HOURS** for local midnight.',
    gridPos: { x, y, w, h },
    datasource: DS,
    fieldConfig: {
      defaults: {
        unit: 'none',
        decimals: 3,
        color: { mode: 'thresholds' },
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'red', value: null },
            { color: 'green', value: 0 },
          ],
        },
        custom: {
          hideFrom: { tooltip: false, viz: false, legend: false },
        },
      },
      overrides: [],
    },
    options: {
      barRadius: 0.06,
      barWidth: 0.86,
      fullHighlight: false,
      groupWidth: 0.72,
      legend: { displayMode: 'list', placement: 'bottom', showLegend: false, calcs: [] },
      orientation: 'vertical',
      showValue: 'auto',
      stacking: 'none',
      tooltip: { mode: 'single', sort: 'none' },
      xField: '_time',
      yField: '_value',
      xTickLabelRotation: -35,
    },
    targets: [
      {
        datasource: DS,
        query: flux,
        refId: 'A',
        format: 'time_series',
      },
    ],
    pluginVersion: '11.4.0',
  };
}

let y = 0;
const panels = [];

panels.push(textPanel(99, y));
y += 3;
panels.push(tablePanel(98, y));
y += 5;

panels.push(rowPanel(200, 'Aranet JSON (from MQTT value_str)', y));
y += 1;
panels.push(
  tsPanel(10, `Slab weight (kg) · sensor ${S.slabWeight}`, y, 8, 8, 0, fluxJsonField(S.slabWeight, 'weight', 'slab'))
);
panels.push(tsPanel(11, `Substrate VWC · sensor ${S.substrate}`, y, 8, 8, 8, fluxJsonField(S.substrate, 'vwc', 'sub')));
panels.push(
  tsPanel(12, `Drainage pulse counter (cumulative) · sensor ${S.drainage}`, y, 8, 8, 16, fluxJsonField(S.drainage, 'pulsescumulative', 'drain'))
);
y += 8;
panels.push(tsPanel(13, 'RSSI (dBm) — all json_measurements sensors', y, 12, 8, 0, fluxRssiAll()));
panels.push(tsPanel(14, 'Battery (V) — all json_measurements sensors', y, 12, 8, 12, fluxBatteryAll()));
y += 8;

panels.push(rowPanel(201, 'Outdoor weather (only if measurement `weather` exists)', y));
y += 1;
panels.push(tsPanel(20, 'PWS temperature & RH (weather)', y, 24, 7, 0, fluxWeatherTemp));
y += 7;

panels.push(rowPanel(202, 'Plant load — daily change (midnight vs previous midnight)', y));
y += 1;
{
  const z = Math.trunc(Number(PLANT_LOAD_DAY_OFFSET_HOURS) || 0);
  const tz = z === 0 ? 'UTC midnight' : z > 0 ? `UTC+${z}h` : `UTC${z}h`;
  const plantLoadDayTitle = `Plant load Δ per day (harvest-adjusted) · sensor ${S.slabWeight} · ${tz}`;
  panels.push(
    plantLoadDailyBarChartPanel(30, plantLoadDayTitle, y, 24, 10, 0, fluxPlantLoadMidnightDeltaPerDay(S.slabWeight, PLANT_LOAD_DAY_OFFSET_HOURS))
  );
}

const dash = {
  annotations: { list: [] },
  editable: true,
  fiscalYearStartMonth: 0,
  graphTooltip: 1,
  links: [],
  liveNow: false,
  panels,
  refresh: '30s',
  schemaVersion: 39,
  style: 'dark',
  tags: ['greenhouse', 'greenctrl', 'influx', 'aranet_mqtt'],
  templating: { list: [] },
  time: { from: 'now-7d', to: 'now' },
  timepicker: {},
  timezone: 'browser',
  title: 'Greenhouse — MQTT / Influx',
  uid: 'greenhouse-overview',
  version: 1,
  weekStart: '',
};

fs.writeFileSync(path.join(__dirname, 'greenhouse-overview.json'), JSON.stringify(dash, null, 2));
console.log('Wrote greenhouse-overview.json');
