'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Repo: backend/ here, greenhouse at ../greenhouse
 * Docker: server in /app with ./greenhouse alongside
 */
function resolveAppRoot() {
  var envRoot = String(process.env.GREENCTRL_APP_ROOT || '').trim();
  if (envRoot) return path.resolve(envRoot);
  var here = path.resolve(__dirname);
  var parent = path.resolve(here, '..');
  try {
    if (fs.existsSync(path.join(parent, 'greenhouse', 'index.html'))) return parent;
    if (fs.existsSync(path.join(here, 'greenhouse', 'index.html'))) return here;
  } catch (_e) {
    /* ignore */
  }
  return parent;
}

module.exports = { resolveAppRoot: resolveAppRoot };
