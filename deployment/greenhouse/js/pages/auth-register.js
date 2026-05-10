(function () {
  const TOKEN_KEY = 'authToken.v1';
  const USER_KEY = 'authUser.v1';
  let pendingIdentity = { username: '', email: '' };

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
    setMsg('Registration is currently disabled.', 'error');
  }

  async function onVerify(e) {
    e.preventDefault();
    setMsg('Verifying email...');
    const code = document.getElementById('verificationCode').value.trim();
    if (!code) {
      setMsg('Please enter your verification code.', 'error');
      return;
    }
    try {
      const res = await window.fetch(apiUrl('/api/auth/verify-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: pendingIdentity.username,
          email: pendingIdentity.email,
          code: code,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Verification failed (${res.status})`);
      window.localStorage.setItem(TOKEN_KEY, payload.token || '');
      window.localStorage.setItem(USER_KEY, JSON.stringify(payload.user || {}));
      setMsg('Email verified. Redirecting...', 'ok');
      window.location.href = 'index.html';
    } catch (err) {
      setMsg(err.message || 'Verification failed', 'error');
    }
  }

  async function onResend() {
    if (!pendingIdentity.username && !pendingIdentity.email) {
      setMsg('Please register first.', 'error');
      return;
    }
    setMsg('Sending a new code...');
    try {
      const res = await window.fetch(apiUrl('/api/auth/resend-verification'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: pendingIdentity.username,
          email: pendingIdentity.email,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Resend failed (${res.status})`);
      setMsg('A new verification code has been sent.', 'ok');
    } catch (err) {
      setMsg(err.message || 'Resend failed', 'error');
    }
  }

  function init() {
    if (window.localStorage.getItem(TOKEN_KEY)) {
      window.location.href = 'index.html';
      return;
    }
    const form = document.getElementById('registerForm');
    if (form) form.addEventListener('submit', onSubmit);
    const verifyForm = document.getElementById('verifyForm');
    if (verifyForm) verifyForm.addEventListener('submit', onVerify);
    const resendBtn = document.getElementById('resendBtn');
    if (resendBtn) resendBtn.addEventListener('click', onResend);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
