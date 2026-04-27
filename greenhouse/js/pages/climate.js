const ClimatePage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const tileMeta = [];
  const SECTION_SLUGS = {
    'Climate strategy': 'climate-strategy',
    Temperature: 'temperature',
    Humidity: 'humidity',
    'Mixing valves': 'mixing-valves',
    'Cooling stages': 'cooling-stages',
    Ventilation: 'ventilation',
    'Air circulation': 'air-circulation',
    Curtain: 'curtain',
    Customization: 'customization',
    'Crop treatment': 'crop-treatment',
  };

  function tile(title, valueHtml, rows, gauge) {
    const id = `climateTile-${tileMeta.length}`;
    tileMeta.push({ id, title, rows, slug: SECTION_SLUGS[title] || 'climate-strategy' });
    const rowsHtml = rows.map((r) => `<div>${r}</div>`).join('');
    const visual = gauge
      ? `<div class="climate-gauge-wrap">${Gauge.html({
        id: gauge.id,
        min: gauge.min,
        max: gauge.max,
        unit: gauge.unit,
        color: gauge.color || 'green',
      })}</div>`
      : `<div class="climate-value-panel">${valueHtml}</div>`;
    return `
      <section class="climate-box clickable" id="${id}" role="button" tabindex="0" title="Open ${title} page">
        <div class="climate-title">${title}</div>
        ${visual}
        <div class="climate-kv">${rowsHtml}</div>
      </section>
    `;
  }

  function renderStatusBar(source) {
    const bar = document.getElementById('climateStatusBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="status-item"><div class="status-dot online"></div><span>Climate page live</span></div>
      <div class="status-item">Station: <span class="font-mono font-semibold">${CONFIG.weatherComStationId}</span></div>
      <div class="status-item">Weather source: <span class="font-mono font-semibold">${source}</span></div>
    `;
  }

  async function render() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    tileMeta.length = 0;
    let weather = {};
    let sensors = {};
    try {
      const data = await WeatherAPI.fetch();
      weather = data.current || {};
      sensors = await SensorAPI.fetchAll(weather);
      renderStatusBar(weather.source || 'local-db');
    } catch (err) {
      renderStatusBar('unavailable');
    }

    const temp = weather.temperature_2m ?? 0;
    const humidity = weather.relative_humidity_2m ?? 0;
    const wind = weather.wind_speed_10m ?? 0;
    const climateTemp = sensors.climate ? sensors.climate.temp : temp;

    const html = [
      tile('Climate strategy', `<span>4</span>`, [
        'Period',
        '<b>4</b>',
      ]),
      tile('Temperature', `${climateTemp}<span class="climate-unit">°C</span>`, [
        `Calculated heating temperature: <b>${(climateTemp - 1).toFixed(1)} °C</b>`,
        `Calculated cooling temperature: <b>${(climateTemp + 1).toFixed(1)} °C</b>`,
      ], { id: 'clGaugeTemp', min: 10, max: 35, unit: '°C', color: 'green' }),
      tile('Humidity', `${humidity}<span class="climate-unit">%</span>`, [
        `Measured absolute humidity: <b>${(humidity * 0.12).toFixed(1)} g/m³</b>`,
        `Measured humidity deficit: <b>${Math.max(0, (100 - humidity) * 0.06).toFixed(1)} g/m³</b>`,
      ], { id: 'clGaugeHumidity', min: 0, max: 100, unit: '%', color: 'green' }),
      tile('Mixing valves', `${Math.round((temp / 40) * 100)}<span class="climate-unit">%</span>`, [
        'Mixing valve status: <b>No limits</b>',
        `Maximum temperature: <b>${Math.max(0, temp + 10).toFixed(1)} °C</b>`,
      ], { id: 'clGaugeMix', min: 0, max: 100, unit: '%', color: 'green' }),
      tile('Cooling stages', `0<span class="climate-unit">%</span>`, [
        'Cooling status',
        '<b>No cooling</b>',
      ], { id: 'clGaugeCooling', min: 0, max: 100, unit: '%', color: 'blue' }),
      tile('Ventilation', `${Math.round(wind)}<span class="climate-unit"> m/s</span>`, [
        'Vent orientation 1: <b>Wind</b>',
        'Vent orientation 2: <b>Lee</b>',
      ], { id: 'clGaugeVent', min: 0, max: 20, unit: 'm/s', color: 'blue' }),
      tile('Air circulation', `100<span class="climate-unit">%</span>`, [
        'Status',
        '<b>Humidity control</b>',
      ], { id: 'clGaugeAir', min: 0, max: 100, unit: '%', color: 'blue' }),
      tile('Curtain', `100<span class="climate-unit">%</span>`, [
        'Curtain status',
        '<b>Night</b>',
      ], { id: 'clGaugeCurtain', min: 0, max: 100, unit: '%', color: 'blue' }),
      tile('Customization', `<span>—</span>`, [
        'Custom setpoint: <b>Off</b>',
        'Override: <b>—</b>',
      ]),
      tile('Crop treatment', `<span>Off</span>`, [
        'Treatment status',
        '<b>Off</b>',
      ]),
    ].join('');

    document.getElementById('climateGrid').innerHTML = html;

    Gauge.update('clGaugeTemp', climateTemp, 10, 35, `${climateTemp}°C`);
    Gauge.update('clGaugeHumidity', humidity, 0, 100, `${humidity}%`);
    Gauge.update('clGaugeMix', Math.round((temp / 40) * 100), 0, 100, `${Math.round((temp / 40) * 100)}%`);
    Gauge.update('clGaugeCooling', 0, 0, 100, '0%');
    Gauge.update('clGaugeVent', wind, 0, 20, `${Math.round(wind)} m/s`);
    Gauge.update('clGaugeAir', 100, 0, 100, '100%');
    Gauge.update('clGaugeCurtain', 100, 0, 100, '100%');

    tileMeta.forEach((m) => {
      const el = document.getElementById(m.id);
      if (!el) return;
      const open = () => { window.location.href = `climate-${m.slug}.html`; };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  return { render };
})();
