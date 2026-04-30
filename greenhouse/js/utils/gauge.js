/**
 * js/utils/gauge.js
 * ─────────────────────────────────────────────────────────────────
 * Renders and updates SVG almost-full-cycle gauge arcs.
 *
 * The gauge uses a circular stroke with a balanced gap so both
 * arc endpoints look symmetric left/right.
 */

const Gauge = (() => {

  const R = 58;
  const CIRC = 2 * Math.PI * R;
  const ARC_VISIBLE = CIRC * 0.75; // symmetric endpoints (left/right level)

  /**
   * Build the SVG markup for a gauge card.
   *
   * @param {object} opts
   *   id        {string}  unique id prefix  (e.g. 'wGauge')
   *   min       {number}  scale minimum
   *   max       {number}  scale maximum
   *   unit      {string}  label below value (e.g. '°C')
   *   color     {string}  'green' | 'blue'
   */
  function html({ id, min, max, unit, color = 'green' }) {
    return `
      <div class="gauge-wrap">
        <svg class="gauge-svg" viewBox="0 0 160 100">
          <circle class="gauge-bg" cx="80" cy="58" r="${R}"
                  transform="rotate(135 80 58)"
                  stroke-dasharray="${ARC_VISIBLE} ${CIRC}"/>
          <circle class="gauge-fill ${color}" id="${id}" cx="80" cy="58" r="${R}"
                  transform="rotate(135 80 58)"
                  stroke-dasharray="${ARC_VISIBLE} ${CIRC}"
                  stroke-dashoffset="${ARC_VISIBLE}"/>
          <text class="gauge-value" text-anchor="middle" dominant-baseline="middle"
                x="80" y="58" id="${id}-val">
            <tspan id="${id}-val-value">—</tspan>
            <tspan class="gauge-unit-inline" dx="2">${unit}</tspan>
          </text>
        </svg>
      </div>`;
  }

  /**
   * Animate the gauge arc to a new value.
   *
   * @param {string} id       DOM id of the <path> element
   * @param {number} value    current reading
   * @param {number} min
   * @param {number} max
   * @param {string} display  text to show in the centre (defaults to value)
   */
  function update(id, value, min, max, display) {
    const arc = document.getElementById(id);
    const lblValue = document.getElementById(`${id}-val-value`);
    if (!arc || !lblValue) return;

    const v = Number(value);
    const lo = Number(min);
    const hi = Number(max);
    const span = hi - lo;
    let pct = 0;
    if (Number.isFinite(v) && Number.isFinite(lo) && Number.isFinite(hi) && span > 0) {
      pct = Math.max(0, Math.min(1, (v - lo) / span));
    }
    arc.style.strokeDashoffset = String(ARC_VISIBLE - pct * ARC_VISIBLE);
    if (display != null && display !== '') {
      lblValue.textContent = display;
    } else {
      lblValue.textContent = Number.isFinite(v) ? String(v) : '—';
    }
  }

  return { html, update };
})();
