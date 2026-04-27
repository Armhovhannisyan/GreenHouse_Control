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
    Ventilation: [
      ['Vent orientation 1', 'Wind'],
      ['Vent orientation 2', 'Lee'],
      ['Vent opening average', '8 %'],
      ['Wind speed', '1 m/s'],
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

  function getSectionName() {
    const slug = document.body && document.body.dataset ? document.body.dataset.sectionSlug : '';
    if (slug && SLUG_TO_SECTION[slug]) return SLUG_TO_SECTION[slug];
    const params = new URLSearchParams(window.location.search);
    const section = params.get('section');
    return section && SECTION_MAP[section] ? section : 'Climate strategy';
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

    const dynamicRows = [
      ['Outdoor temperature', `${temp} °C`],
      ['Outdoor humidity', `${hum} %`],
      ['Wind speed', `${wind} m/s`],
      ['Climate temp', `${ctemp} °C`],
    ];

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
    const sectionName = getSectionName();
    document.getElementById('climateSectionTitle').textContent = sectionName;
    renderStatusBar(sectionName);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
