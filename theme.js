(() => {
  const key = 'bokobok-theme';
  const root = document.documentElement;
  let saved;
  try { saved = localStorage.getItem(key); } catch (_) { /* Storage can be unavailable. */ }
  const initial = saved === 'dark' ? 'dark' : 'light';

  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const next = theme === 'dark' ? 'light' : 'dark';
      button.textContent = next === 'dark' ? '☾ Тёмная тема' : '☀ Светлая тема';
      button.setAttribute('aria-label', next === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему');
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = next === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему';
    });
  }

  apply(initial);
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, theme); } catch (_) { /* The current page still switches. */ }
      apply(theme);
    }));
  });
})();
