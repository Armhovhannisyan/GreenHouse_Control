/**
 * js/components/alerts.js
 * ─────────────────────────────────────────────────────────────────
 * Derives alert messages from live sensor data and renders them.
 * Add your own rules inside the RULES array.
 */

const Alerts = (() => {

  /**
   * Each rule is a function(weather, sensors) → alert object or null.
   * Return { type, msg } to raise an alert, or null to suppress.
   *
   * type: 'warn' | 'info' | 'danger'
   */
  const RULES = [
    (w)    => (w.temperature_2m   < 2)   && { type: 'danger', msg: 'Outside temperature below 2 °C — frost risk' },
    (w)    => (w.temperature_2m   > 35)  && { type: 'warn',   msg: 'Outside temperature above 35 °C — ventilation recommended' },
    (w)    => (w.wind_speed_10m   > 15)  && { type: 'warn',   msg: `High wind speed: ${w.wind_speed_10m} m/s` },
    (_, s) => (s.climate.heating  === 'Active') && { type: 'info', msg: 'Climate zone 1: heating active' },
    (_, s) => (s.climate.cooling  === 'Active') && { type: 'warn', msg: 'Climate zone 1: cooling active' },
    (_, s) => (s.waterRoom.status === 'Running') && { type: 'info', msg: `Water room: irrigation running at ${s.waterRoom.flow} m³/h` },
  ];

  function evaluate(weather, sensors) {
    const now = Helpers.timeStr();
    const active = RULES
      .map(rule => rule(weather, sensors))
      .filter(Boolean)
      .map(a => ({ ...a, time: now }));

    // Always append a data-refresh info entry
    active.push({ type: 'info', msg: 'Data refreshed successfully', time: now });

    return active;
  }

  function render(weather, sensors) {
    const alerts = evaluate(weather, sensors);
    const list   = document.getElementById('alertsList');

    Header.updateBadge(alerts.length);

    if (!alerts.length) {
      list.innerHTML = '<div class="no-alerts">No active alerts.</div>';
      return;
    }

    list.innerHTML = alerts.map(a => `
      <div class="alert-row ${a.type}">
        <span class="alert-time">${a.time}</span>
        <span class="alert-msg">${a.msg}</span>
        <span class="alert-tag ${a.type}">${a.type.toUpperCase()}</span>
      </div>`
    ).join('');
  }

  return { render };
})();
