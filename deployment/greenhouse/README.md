# GreenCtrl — Greenhouse Operator Dashboard

A Priva Compass–style greenhouse monitoring dashboard.
Fetches outdoor weather from Open-Meteo (free, no key needed)
and reads indoor sensor data from your local meteo-station API.

---

## Project structure

```
greenhouse/
│
├── index.html                  ← Entry point, loads all CSS & JS
│
├── css/
│   ├── base.css                ← Design tokens (CSS variables) & reset
│   ├── layout.css              ← Header, sidebar, main, status bar
│   ├── components.css          ← Cards, gauges, buttons, alerts
│   └── charts.css              ← Chart section & time-range selector
│
└── js/
    ├── config.js               ← 🔧 ALL configurable values (edit this first)
    │
    ├── api/
    │   ├── weather.js          ← Open-Meteo outdoor weather fetch
    │   └── sensors.js          ← Local sensor API + simulation fallback
    │
    ├── components/
    │   ├── header.js           ← Top nav bar
    │   ├── sidebar.js          ← Left sidebar
    │   ├── cards.js            ← Five zone cards + gauge updates
    │   ├── charts.js           ← Chart.js line charts
    │   └── alerts.js           ← Alert rules engine + render
    │
    └── app.js                  ← Bootstrap & data-fetch orchestrator
```

---

## Quick start

1. **Open** `index.html` in any browser (Chrome / Firefox / Edge).
   The dashboard immediately loads with live outdoor weather and simulated sensor data.

2. **Edit `js/config.js`** to point it at your greenhouse:

   ```js
   lat: 40.1872,          // your greenhouse latitude
   lon: 44.5152,          // your greenhouse longitude

   sensorBaseUrl: 'http://192.168.1.100',   // your station's local IP
   ```

3. If `sensorBaseUrl` is empty the app runs in **simulation mode** — all indoor
   readings are realistic random values derived from the outdoor temperature.

---

## Connecting your sensor station

Each `sensorEndpoints` path in `config.js` maps to one `fetch()` call in
`js/api/sensors.js`. Edit the field-name mappings in the four `fetch*()` functions
to match whatever JSON your station actually returns.

### Common station protocols

| Protocol | What to do |
|---|---|
| **REST / JSON** (most modern units) | Point `sensorBaseUrl` at the IP; adjust field names in `sensors.js` |
| **MQTT over WebSocket** | Add an MQTT-WS client library and publish to the same `SensorData` shape |
| **Modbus TCP** | Use a Node.js bridge (e.g. `node-modbus`) that exposes a REST API |

### Adding alert rules

Open `js/components/alerts.js` and add a function to the `RULES` array:

```js
(weather, sensors) =>
  sensors.climate.humidity > 85 && { type: 'warn', msg: 'Humidity above 85% — ventilation needed' },
```

---

## Deployment

Since this is plain HTML + CSS + JS with no build step, you can serve it with
any static file server:

```bash
# Python (built-in)
python3 -m http.server 8080

# Node (npx)
npx serve .

# Or just open index.html directly in a browser
```

> **CORS note:** if your sensor API runs on a different host/port, enable
> `Access-Control-Allow-Origin: *` on the sensor server, or run a small proxy.
