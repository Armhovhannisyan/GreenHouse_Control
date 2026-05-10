/**
 * js/utils/logger.js
 * Lightweight app logger for UI actions and runtime errors.
 */
const Logger = (() => {
  const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR', action: 'ACTION' };
  const TOKEN_KEY = 'authToken.v1';
  let buttonLoggingBound = false;

  function stamp() {
    return new Date().toISOString();
  }

  function write(level, message, details) {
    const tag = LEVELS[level] || 'INFO';
    const payload = {
      ts: stamp(),
      level: tag,
      message,
      details: details || null,
    };
    if (!window.__APP_LOGS__) window.__APP_LOGS__ = [];
    window.__APP_LOGS__.push(payload);
    if (window.__APP_LOGS__.length > 500) {
      window.__APP_LOGS__ = window.__APP_LOGS__.slice(-500);
    }

    const text = `[${payload.ts}] [${tag}] ${message}`;
    if (level === 'error') console.error(text, details || '');
    else if (level === 'warn') console.warn(text, details || '');
    else console.log(text, details || '');
    postUiLog(level, message, details || null);
  }

  function postUiLog(level, message, details) {
    try {
      if (typeof window.fetch !== 'function') return;
      const base = typeof CONFIG !== 'undefined' && CONFIG && CONFIG.backendBaseUrl
        ? String(CONFIG.backendBaseUrl).replace(/\/$/, '')
        : '';
      if (!base) return;
      const headers = { 'Content-Type': 'application/json' };
      const token = window.localStorage.getItem(TOKEN_KEY) || '';
      if (token) headers.Authorization = 'Bearer ' + token;
      window.fetch(base + '/api/ui-log', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          level: String(level || 'info').toLowerCase(),
          message: String(message || ''),
          details: details || null,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (_e) {
      /* ignore */
    }
  }

  function info(message, details) { write('info', message, details); }
  function warn(message, details) { write('warn', message, details); }
  function error(message, details) { write('error', message, details); }
  function action(message, details) { write('action', message, details); }

  function trimText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function bindButtonClickLogging() {
    if (buttonLoggingBound) return;
    buttonLoggingBound = true;
    document.addEventListener('click', function (e) {
      const el = e.target && e.target.closest
        ? e.target.closest('button, .btn, [role="button"], input[type="button"], input[type="submit"]')
        : null;
      if (!el) return;
      const label = trimText(
        el.getAttribute('aria-label') ||
        el.title ||
        ('value' in el ? el.value : '') ||
        el.textContent ||
        ''
      );
      action('Button click', {
        id: el.id || null,
        className: el.className || null,
        label: label || null,
        tag: el.tagName || null,
        name: el.getAttribute('name') || null,
        path: window.location.pathname || '',
      });
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtonClickLogging);
  } else {
    bindButtonClickLogging();
  }

  return { info, warn, error, action, bindButtonClickLogging };
})();
