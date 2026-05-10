/**
 * js/utils/helpers.js
 * ─────────────────────────────────────────────────────────────────
 * Small, pure helper functions shared across the app.
 */

const Helpers = (() => {

  /** Format a Date to HH:MM */
  function timeStr(date = new Date()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Clamp a number between min and max */
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /** Round to N decimal places */
  function round(val, decimals = 1) {
    return +val.toFixed(decimals);
  }

  /**
   * Set the text content and colour-utility class on a stat-value element.
   * @param {string} id   element id
   * @param {string} text display text
   * @param {string} cls  'ok' | 'warn' | 'danger' | 'off' | ''
   */
  function setStat(id, text, cls = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `stat-value${cls ? ' text-' + cls : ''}`;
  }

  /**
   * Build an SVG icon string (inline, no external deps).
   * Only the icons actually used in the app are included.
   */
  const ICONS = {
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>`,
    bell:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>`,
    user:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>`,
    help:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>`,
  };

  return { timeStr, clamp, round, setStat, ICONS };
})();
