/**
 * js/utils/logger.js
 * Lightweight app logger for UI actions and runtime errors.
 */
const Logger = (() => {
  const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR', action: 'ACTION' };

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
  }

  function info(message, details) { write('info', message, details); }
  function warn(message, details) { write('warn', message, details); }
  function error(message, details) { write('error', message, details); }
  function action(message, details) { write('action', message, details); }

  return { info, warn, error, action };
})();
