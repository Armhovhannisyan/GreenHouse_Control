const Auth = (() => {
  const TOKEN_KEY = 'authToken.v1';
  const USER_KEY = 'authUser.v1';

  function getToken() {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(token, user) {
    window.localStorage.setItem(TOKEN_KEY, token || '');
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  }

  function authFetch(url, options = {}) {
    const token = getToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return window.fetch(url, { ...options, headers });
  }

  function requireAuth(redirectTo = 'login.html') {
    if (!getToken()) {
      window.location.href = redirectTo;
      return false;
    }
    return true;
  }

  async function me(apiBase) {
    const res = await authFetch(`${apiBase}/api/auth/me`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Not authenticated');
    return res.json();
  }

  return { getToken, setSession, clearSession, authFetch, requireAuth, me };
})();
