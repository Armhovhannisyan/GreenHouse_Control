/**
 * js/components/header.js
 * ─────────────────────────────────────────────────────────────────
 * Renders the top navigation header and exposes updateBadge().
 */

const Header = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const USER_KEY = 'authUser.v1';

  function apiUrl(path) {
    const base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
    return `${base}${path}`;
  }

  function hasSession() {
    return Boolean(window.localStorage.getItem(TOKEN_KEY));
  }

  function currentUsername() {
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      if (!raw) return '';
      const user = JSON.parse(raw);
      return user && user.username ? String(user.username) : '';
    } catch (_err) {
      return '';
    }
  }

  function toTitleCase(text) {
    return String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  function authFetch(url, options = {}) {
    const token = window.localStorage.getItem(TOKEN_KEY) || '';
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return window.fetch(url, { ...options, headers });
  }

  async function logout() {
    try {
      await authFetch(apiUrl('/api/auth/logout'), { method: 'POST' });
    } catch (_err) {
      // best effort logout even when backend is not reachable
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.location.href = 'login.html';
  }

  function render() {
    document.getElementById('app-header').innerHTML = `
      <a class="logo" href="/greenhouse/index.html" title="Go to home">
        <span class="logo-box">GC</span>
        Operator
        ${hasSession() ? `<span class="header-user-near-logo">${toTitleCase(currentUsername() || 'operator')}</span>` : ''}
      </a>
      <span class="header-spacer"></span>
      ${hasSession() ? '<button class="header-logout-btn" id="headerLogoutBtn" type="button">Logout</button>' : ''}
    `;
    const logoutBtn = document.getElementById('headerLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
  }

  function updateBadge(count) {
    const el = document.getElementById('alertBadge');
    if (el) el.textContent = count;
  }

  return { render, updateBadge };
})();
