(() => {
  function setup(sidebar, kind) {
    if (!sidebar) return;
    const brand = sidebar.querySelector(kind === 'admin' ? '.admin-brand' : '.wordmark');
    const navigation = sidebar.querySelector('nav');
    const theme = sidebar.querySelector('[data-theme-toggle]');
    const logout = sidebar.querySelector(kind === 'admin' ? '#adminLogout' : '#logoutButton');
    if (!brand || !navigation) return;

    const topbar = document.createElement('div');
    topbar.className = 'mobile-topbar';
    const brandLink = brand.cloneNode(true);
    brandLink.removeAttribute('id');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-menu-toggle';
    toggle.setAttribute('aria-label', 'Открыть меню');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    topbar.append(brandLink, toggle);

    const panel = document.createElement('div');
    panel.className = 'mobile-menu-panel';
    panel.id = `${kind}-mobile-menu`;
    panel.hidden = true;
    toggle.setAttribute('aria-controls', panel.id);
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'mobile-menu-scrim';
    scrim.setAttribute('aria-label', 'Закрыть меню');
    scrim.hidden = true;
    sidebar.prepend(topbar);
    sidebar.append(panel);
    document.body.append(scrim);

    function close() {
      panel.hidden = true;
      scrim.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Открыть меню');
      sidebar.classList.remove('mobile-menu-open');
    }
    function action(label, original, className = '') {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = className;
      item.textContent = label;
      item.addEventListener('click', () => {
        close();
        original.click();
      });
      return item;
    }
    function open() {
      panel.replaceChildren();
      const links = document.createElement('nav');
      links.className = 'mobile-menu-links';
      navigation.querySelectorAll('button').forEach(original => {
        if (original.hidden) return;
        const item = action(original.textContent.trim(), original, original.classList.contains('active') || original.classList.contains('is-active') ? 'is-active' : '');
        links.append(item);
      });
      panel.append(links);
      const account = document.createElement('div');
      account.className = 'mobile-menu-account';
      const name = sidebar.querySelector(kind === 'admin' ? '#adminName' : '#userName')?.textContent.trim();
      if (name) {
        const label = document.createElement('strong');
        label.textContent = name;
        account.append(label);
      }
      if (theme) account.append(action(theme.textContent.trim(), theme));
      if (logout) account.append(action('Выйти', logout, 'mobile-menu-logout'));
      panel.append(account);
      panel.hidden = false;
      scrim.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Закрыть меню');
      sidebar.classList.add('mobile-menu-open');
    }
    toggle.addEventListener('click', () => panel.hidden ? open() : close());
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus(); }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 760 && !panel.hidden) close();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
  function init() {
    setup(document.querySelector('#workspace > aside'), 'workspace');
    setup(document.querySelector('.admin-sidebar'), 'admin');
  }
})();
