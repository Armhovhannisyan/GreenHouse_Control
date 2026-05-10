/**
 * js/components/sidebar.js
 * ─────────────────────────────────────────────────────────────────
 * Renders the left sidebar navigation.
 */

const Sidebar = (() => {

  const ITEMS = ['Overview', 'Alarms', 'Reports', 'Schedules', 'History'];

  function render() {
    const links = ITEMS.map((label, i) =>
      `<a class="${i === 0 ? 'active' : ''}" data-sidebar="${label}">${label}</a>`
    ).join('');

    document.getElementById('app-sidebar').innerHTML = links;

    document.getElementById('app-sidebar').addEventListener('click', e => {
      const link = e.target.closest('[data-sidebar]');
      if (!link) return;
      document.querySelectorAll('#app-sidebar a').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
    });
  }

  return { render };
})();
