(function () {
  const TOKEN_KEY = 'authToken.v1';
  const USER_KEY = 'authUser.v1';

  function apiUrl(path) {
    const base = (CONFIG.backendBaseUrl || '').replace(/\/$/, '');
    return `${base}${path}`;
  }

  function setMsg(text, cls) {
    const el = document.getElementById('authMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `auth-msg ${cls || ''}`.trim();
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMsg('Signing in...');
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    try {
      const res = await window.fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Login failed (${res.status})`);
      window.localStorage.setItem(TOKEN_KEY, payload.token || '');
      window.localStorage.setItem(USER_KEY, JSON.stringify(payload.user || {}));
      setMsg('Login successful. Redirecting...', 'ok');
      window.location.href = 'index.html';
    } catch (err) {
      setMsg(err.message || 'Login failed', 'error');
    }
  }

  function init() {
    if (window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'index.html';
      return;
    }
    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', onSubmit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
