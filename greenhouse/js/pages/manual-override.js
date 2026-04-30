/**
 * Manual Override — Sonoff / eWeLink relay list and on/off/toggle.
 */
const ManualOverridePage = (() => {
  const TOKEN_KEY = 'authToken.v1';
  let lastRelayModes = {};

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function modeKey(deviceId, channel) {
    return String(deviceId || '').trim() + ':' + String(Number(channel));
  }

  function buildRelayRows(devices, relayModes) {
    const rows = [];
    (Array.isArray(devices) ? devices : []).forEach((d) => {
      const name = d && d.name ? d.name : d && d.deviceid ? d.deviceid : 'Unknown';
      const id = d && d.deviceid ? d.deviceid : '';
      const online = d && d.online !== false;
      const switches = Array.isArray(d && d.switches) ? d.switches : null;
      if (switches && switches.length) {
        switches.forEach((s, idx) => {
          const channel = Number.isFinite(Number(s && s.outlet)) ? Number(s.outlet) : idx + 1;
          const on = String((s && s.switch) || '').toLowerCase() === 'on';
          const mode = String((relayModes || {})[modeKey(id, channel)] || '').toLowerCase() === 'manual' ? 'manual' : 'automatic';
          rows.push({ name, id, channel, state: on ? 'On' : 'Off', online, mode });
        });
      } else if (d && d.switch != null && d.switch !== '') {
        const on = String(d.switch).toLowerCase() === 'on';
        const mode = String((relayModes || {})[modeKey(id, 1)] || '').toLowerCase() === 'manual' ? 'manual' : 'automatic';
        rows.push({ name, id, channel: 1, state: on ? 'On' : 'Off', online, mode });
      }
    });
    return rows;
  }

  function renderRelayList(devices, relayModes, errorMessage) {
    const summary = document.getElementById('moPageSummary');
    const list = document.getElementById('moRelayList');
    if (!summary || !list) return;

    if (errorMessage) {
      summary.textContent = errorMessage;
      list.innerHTML = '';
      return;
    }

    const rows = buildRelayRows(devices, relayModes);
    if (!rows.length) {
      summary.textContent =
        'No relay channels reported. Complete eWeLink OAuth (or legacy login) in the backend, then refresh.';
      list.innerHTML = '';
      return;
    }

    summary.textContent = `${rows.length} relay channel(s) from eWeLink. Manual mode locks control to this page only.`;
    const maxNameLen = rows.reduce((acc, r) => Math.max(acc, String(r.name || '').length), 0);
    const nameColCh = Math.min(40, Math.max(14, maxNameLen + 2));
    list.style.setProperty('--mo-name-col-ch', `${nameColCh}ch`);
    list.innerHTML = rows
      .map(
        (r) => `
      <div class="manual-override-row">
        <div class="manual-override-line">
          <span class="manual-override-name">${escapeHtml(r.name)}${r.online ? '' : ' (offline)'}</span>
          <span class="manual-override-sep">:</span>
          <select class="manual-override-mode-select" data-mo-mode-device="${escapeHtml(r.id)}" data-mo-mode-channel="${r.channel}">
            <option value="automatic"${r.mode === 'automatic' ? ' selected' : ''}>Automatic</option>
            <option value="manual"${r.mode === 'manual' ? ' selected' : ''}>Manual</option>
          </select>
          <span class="manual-override-sep">:</span>
          <span class="manual-override-state ${r.state === 'On' ? 'is-on' : 'is-off'}">${r.state}</span>
          <label class="manual-override-switch">
            <input
              type="checkbox"
              class="manual-override-switch-input"
              data-mo-switch-device="${escapeHtml(r.id)}"
              data-mo-switch-channel="${r.channel}"
              ${r.state === 'On' ? 'checked' : ''}
              ${r.mode === 'manual' ? '' : 'disabled'}
            />
            <span class="manual-override-slider" aria-hidden="true"></span>
          </label>
        </div>
      </div>`
      )
      .join('');
  }

  function setStatusBar(state) {
    const bar = document.getElementById('moStatusBar');
    if (!bar) return;
    const dotCls = { online: 'online', offline: 'offline', loading: 'loading' }[state] || 'loading';
    const label =
      { online: 'Connected', offline: 'Could not load devices', loading: 'Loading…' }[state] || '';
    bar.innerHTML = `
      <div class="status-item">
        <div class="status-dot ${dotCls}" id="moConnDot"></div>
        <span id="moConnLabel">${label}</span>
      </div>
      <div class="status-item">Sonoff / eWeLink</div>
    `;
  }

  async function loadDevices() {
    setStatusBar('loading');
    const summary = document.getElementById('moPageSummary');
    if (summary) summary.textContent = 'Loading Sonoff devices…';

    if (typeof SonoffAPI === 'undefined' || !SonoffAPI.fetchRelayDevicesWithStatus) {
      renderRelayList([], {}, 'Sonoff API is not available.');
      setStatusBar('offline');
    } else {
      const { ok, devices, relayModes, error } = await SonoffAPI.fetchRelayDevicesWithStatus();
      lastRelayModes = relayModes || {};
      if (!ok) {
        renderRelayList([], {}, error || 'Failed to load devices from eWeLink.');
        setStatusBar('offline');
      } else {
        renderRelayList(devices, lastRelayModes, null);
        setStatusBar('online');
      }
    }

    const last = document.getElementById('moLastUpdated');
    if (last) last.textContent = Helpers.timeStr();
  }

  function bindControls() {
    const list = document.getElementById('moRelayList');
    if (!list) return;
    list.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-mo-mode-device]');
      if (!sel || !list.contains(sel)) return;
      const deviceId = String(sel.getAttribute('data-mo-mode-device') || '').trim();
      const channel = Number(sel.getAttribute('data-mo-mode-channel') || '1');
      const mode = String(sel.value || '').toLowerCase();
      if (!deviceId || !Number.isFinite(channel) || !['automatic', 'manual'].includes(mode)) return;
      const row = sel.closest('.manual-override-row');
      const sw = row ? row.querySelector('[data-mo-switch-device]') : null;
      const prevMode = String(lastRelayModes[modeKey(deviceId, channel)] || 'automatic').toLowerCase() === 'manual' ? 'manual' : 'automatic';
      if (sw) sw.disabled = mode !== 'manual';
      sel.disabled = true;
      try {
        await SonoffAPI.setRelayMode(deviceId, channel, mode);
        lastRelayModes[modeKey(deviceId, channel)] = mode;
        await loadDevices();
      } catch (err) {
        if (sw) sw.disabled = prevMode !== 'manual';
        sel.value = prevMode;
        const summary = document.getElementById('moPageSummary');
        if (summary) {
          const msg = err && err.message ? err.message : 'unknown error';
          summary.textContent = `Failed to save relay mode (${msg}). If endpoint is missing, restart backend.`;
        }
      } finally {
        sel.disabled = false;
      }
    });
    list.addEventListener('change', async (e) => {
      const sw = e.target.closest('[data-mo-switch-device]');
      if (!sw || !list.contains(sw)) return;
      const deviceId = String(sw.getAttribute('data-mo-switch-device') || '').trim();
      const channel = Number(sw.getAttribute('data-mo-switch-channel') || '1');
      const action = sw.checked ? 'on' : 'off';
      if (!deviceId || !Number.isFinite(channel)) return;
      sw.disabled = true;
      try {
        await SonoffAPI.controlRelay(deviceId, action, channel);
        await loadDevices();
      } catch (_err) {
        sw.checked = !sw.checked;
        const summary = document.getElementById('moPageSummary');
        if (summary) {
          summary.textContent = 'Control failed — check device online state and try again.';
        }
      } finally {
        sw.disabled = false;
      }
    });
  }

  function renderActions() {
    const bar = document.getElementById('moActionsBar');
    if (!bar) return;
    bar.innerHTML = `
      <button class="btn btn-primary" id="moRefreshBtn" type="button" title="Reload relay states">
        <span id="moRefreshIcon">${Helpers.ICONS.refresh}</span>
        Refresh relays
      </button>
      <a class="btn btn-secondary" href="index.html">Back to dashboard</a>
    `;
    const btn = document.getElementById('moRefreshBtn');
    if (btn) btn.addEventListener('click', () => loadDevices());
  }

  function init() {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'login.html';
      return;
    }
    Header.render();
    Sidebar.render();
    setStatusBar('loading');
    renderActions();
    bindControls();
    loadDevices();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { loadDevices };
})();
