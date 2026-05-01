/**
 * js/components/cards.js
 * ─────────────────────────────────────────────────────────────────
 * Builds the zone cards on first load, then provides
 * an update() method to refresh values without re-rendering DOM.
 */

const Cards = (() => {
  function updatePrecisionGrowingCard(climate, precisionGrowing) {
    const leafTemp = Number(precisionGrowing && precisionGrowing.leafTemp != null ? precisionGrowing.leafTemp : climate.temp);
    const rh = Number(climate.humidity);
    const leafTempOk = Number.isFinite(leafTemp);
    const vpdFromPg = Number(precisionGrowing && precisionGrowing.vpd);
    const vpdFromPgOk = Number.isFinite(vpdFromPg);
    const rhOk = Number.isFinite(rh);

    const [cMin, cMax] = CONFIG.gaugeRanges.climate;
    Gauge.update('piGauge', leafTempOk ? leafTemp : 0, cMin, cMax, leafTempOk ? leafTemp.toFixed(1) : '—');
    Helpers.setStat('piLeafTemp', leafTempOk ? `${leafTemp.toFixed(1)} °C` : '— °C');
    if (vpdFromPgOk) {
      Helpers.setStat('piVpd', `${vpdFromPg.toFixed(2)} kPa`, 'ok');
    } else if (leafTempOk && rhOk && rh >= 0 && rh <= 100) {
      const svp = 0.6108 * Math.exp((17.27 * leafTemp) / (leafTemp + 237.3));
      const vpd = svp * (1 - rh / 100);
      Helpers.setStat('piVpd', `${vpd.toFixed(2)} kPa`, 'ok');
    } else {
      Helpers.setStat('piVpd', '— kPa', 'off');
    }

  }

  /* ── Initial render ── */
  function render() {
    const [wMin, wMax] = CONFIG.gaugeRanges.weather;
    const [cMin, cMax] = CONFIG.gaugeRanges.climate;
    const [wrMin, wrMax] = CONFIG.gaugeRanges.waterFlow;
    const [eMin, eMax] = CONFIG.gaugeRanges.energyTemp;

    document.getElementById('cardsGrid').innerHTML = `

      <!-- WEATHER ZONE -->
      <div class="card card-clickable" id="weatherZoneCard" title="Open weather reports" role="button" tabindex="0">
        <div class="card-title"><span class="card-icon">🌤</span> Weather zone 1</div>
        ${Gauge.html({ id: 'wGauge', min: wMin, max: wMax, unit: '°C', color: 'green' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Outside light intensity</div>
            <div class="stat-value font-mono" id="wLight">— W/m²</div>
          </div>
          <div class="stat">
            <div class="stat-label">Wind speed</div>
            <div class="stat-value font-mono" id="wWind">— m/s</div>
          </div>
        </div>
      </div>

      <!-- CLIMATE -->
      <div class="card card-clickable" id="climateZoneCard" title="Open climate page" role="button" tabindex="0">
        <div class="card-title"><span class="card-icon">🌱</span> Climate</div>
        ${Gauge.html({ id: 'cGauge', min: cMin, max: cMax, unit: '°C', color: 'green' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Heating status</div>
            <div class="stat-value font-mono" id="cHeat">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">Cooling status</div>
            <div class="stat-value font-mono" id="cCool">—</div>
          </div>
        </div>
      </div>

      <!-- IRRIGATION -->
      <div class="card">
        <div class="card-title"><span class="card-icon">💧</span> Irrigation zone 1</div>
        <div class="irr-icon">💧</div>
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Valves active</div>
            <div class="stat-value font-mono" id="irrActive">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">Valves waiting</div>
            <div class="stat-value font-mono" id="irrWait">—</div>
          </div>
        </div>
      </div>

      <!-- WATER ROOM -->
      <div class="card">
        <div class="card-title"><span class="card-icon">🚰</span> Water room zone 1</div>
        ${Gauge.html({ id: 'wrGauge', min: wrMin, max: wrMax, unit: 'm³/h', color: 'blue' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Status</div>
            <div class="stat-value font-mono" id="wrStatus">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">Current recipe</div>
            <div class="stat-value font-mono" id="wrRecipe">—</div>
          </div>
        </div>
      </div>

      <!-- ENERGY ROOM -->
      <div class="card">
        <div class="card-title"><span class="card-icon">🌡</span> Energy room zone 1</div>
        ${Gauge.html({ id: 'erGauge', min: eMin, max: eMax, unit: '°C', color: 'green' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Control mode</div>
            <div class="stat-value font-mono" id="erMode">—</div>
          </div>
          <div class="stat">
            <div class="stat-label">Energy custom program</div>
            <div class="stat-value font-mono" id="erProg">—</div>
          </div>
        </div>
      </div>

      <!-- MANUAL OVERRIDE -->
      <div class="card card-clickable" id="manualOverrideCard" title="Open Sonoff manual control" role="button" tabindex="0">
        <div class="card-title"><span class="card-icon">🕹️</span> Manual Override</div>
        ${Gauge.html({ id: 'moGauge', min: cMin, max: cMax, unit: '°C', color: 'green' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Sonoff / eWeLink</div>
            <div class="stat-value font-mono" id="moStatSource">Relays</div>
          </div>
          <div class="stat">
            <div class="stat-label">Control</div>
            <div class="stat-value font-mono" id="moStatHint">Open page</div>
          </div>
        </div>
      </div>

      <!-- PRECISION GROWING -->
      <div class="card card-clickable" id="precisionGrowingCard" title="Open Precision Growing details" role="button" tabindex="0">
        <div class="card-title"><span class="card-icon">🌿</span> Precision Growing</div>
        ${Gauge.html({ id: 'piGauge', min: cMin, max: cMax, unit: '°C', color: 'green' })}
        <div class="card-stats">
          <div class="stat">
            <div class="stat-label">Leaf temp</div>
            <div class="stat-value font-mono" id="piLeafTemp">— °C</div>
          </div>
          <div class="stat">
            <div class="stat-label">VPD</div>
            <div class="stat-value font-mono" id="piVpd">— kPa</div>
          </div>
        </div>
      </div>
    `;

    const weatherCard = document.getElementById('weatherZoneCard');
    if (weatherCard) {
      weatherCard.addEventListener('click', () => {
        window.location.href = 'weather.html';
      });
      weatherCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = 'weather.html';
        }
      });
    }

    const climateCard = document.getElementById('climateZoneCard');
    if (climateCard) {
      climateCard.addEventListener('click', () => {
        window.location.href = 'climate.html';
      });
      climateCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = 'climate.html';
        }
      });
    }

    const moCard = document.getElementById('manualOverrideCard');
    if (moCard) {
      moCard.addEventListener('click', () => {
        window.location.href = 'manual-override.html';
      });
      moCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = 'manual-override.html';
        }
      });
    }

    const pgCard = document.getElementById('precisionGrowingCard');
    if (pgCard) {
      pgCard.addEventListener('click', () => {
        window.location.href = 'precision-growing.html';
      });
      pgCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = 'precision-growing.html';
        }
      });
    }
  }

  /* ── Update values (no DOM rebuild) ── */
  function update(weather, sensors) {
    const [wMin, wMax]  = CONFIG.gaugeRanges.weather;
    const [cMin, cMax]  = CONFIG.gaugeRanges.climate;
    const [wrMin, wrMax]= CONFIG.gaugeRanges.waterFlow;
    const [eMin, eMax]  = CONFIG.gaugeRanges.energyTemp;

    // Weather
    const temp = Number(weather.temperature_2m);
    const wind = Number(weather.wind_speed_10m);
    const light = Number(weather.shortwave_radiation);
    const tempValid = Number.isFinite(temp);
    const windValid = Number.isFinite(wind);
    const lightValid = Number.isFinite(light);
    Gauge.update('wGauge', tempValid ? temp : 0, wMin, wMax, tempValid ? temp.toFixed(1) : '—');
    Helpers.setStat('wLight', lightValid ? (light.toFixed(1) + ' W/m²') : '— W/m²');
    Helpers.setStat('wWind', windValid ? (wind.toFixed(1) + ' m/s') : '— m/s');

    // Climate
    const { climate } = sensors;
    Gauge.update('cGauge', climate.temp, cMin, cMax, climate.temp);
    Helpers.setStat('cHeat', climate.heating, climate.heating === 'Active' ? 'warn' : 'off');
    Helpers.setStat('cCool', climate.cooling, climate.cooling === 'Active' ? 'warn' : 'off');

    // Irrigation
    Helpers.setStat('irrActive', sensors.irrigation.active,  'ok');
    Helpers.setStat('irrWait',   sensors.irrigation.waiting, 'off');

    // Water room
    const { waterRoom } = sensors;
    Gauge.update('wrGauge', waterRoom.flow, wrMin, wrMax, waterRoom.flow);
    Helpers.setStat('wrStatus', waterRoom.status, waterRoom.status === 'Off' ? 'off' : 'ok');
    Helpers.setStat('wrRecipe', waterRoom.recipe);

    // Energy room
    const { energyRoom } = sensors;
    Gauge.update('erGauge', energyRoom.temp, eMin, eMax, energyRoom.temp);
    Helpers.setStat('erMode', energyRoom.mode, 'ok');
    Helpers.setStat('erProg', energyRoom.program, energyRoom.program === 'Off' ? 'off' : 'ok');

    // Manual override card (opens manual-override.html for Sonoff relays)
    Gauge.update('moGauge', climate.temp, cMin, cMax, climate.temp);
    Helpers.setStat('moStatSource', 'Relays', 'ok');
    Helpers.setStat('moStatHint', 'Open page', 'off');

    updatePrecisionGrowingCard(climate, sensors && sensors.precisionGrowing ? sensors.precisionGrowing : null);

  }

  return { render, update };
})();
