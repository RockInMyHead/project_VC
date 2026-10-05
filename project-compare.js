const ProjectCompare = (() => {
  const MAX_PROJECTS = 4;
  const statusNames = {completed: 'Завершено', in_progress: 'В работе', planned: 'В плане'};
  const el = (tag, className = '', value) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (label, className, action) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const svg = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };

  function layout(stages) {
    const byId = new Map(stages.map(stage => [stage.public_id, stage]));
    const children = new Map(stages.map(stage => [stage.public_id, []]));
    const roots = [];
    stages.forEach(stage => {
      if (stage.parent_public_id !== stage.public_id && byId.has(stage.parent_public_id)) children.get(stage.parent_public_id).push(stage);
      else roots.push(stage);
    });
    const points = new Map(), seen = new Set();
    let leaf = 0, depthMax = 0;
    function place(stage, depth) {
      if (seen.has(stage.public_id)) return null;
      seen.add(stage.public_id);
      depthMax = Math.max(depthMax, depth);
      const rows = children.get(stage.public_id).map(child => place(child, depth + 1)).filter(row => row !== null);
      const y = rows.length ? (rows[0] + rows.at(-1)) / 2 : 110 + leaf++ * 106;
      points.set(stage.public_id, {x: 72 + depth * 142, y});
      return y;
    }
    roots.forEach(stage => place(stage, 0));
    stages.forEach(stage => { if (!seen.has(stage.public_id)) place(stage, 0); });
    return {points, width: Math.max(650, 72 + depthMax * 142 + 340), height: Math.max(330, 110 + Math.max(0, leaf - 1) * 106 + 250)};
  }

  function graph(project, detail, openProject) {
    const stages = [...(detail.stages || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    const section = el('section', 'compare-project');
    const heading = el('div', 'compare-project-head');
    const title = el('div');
    title.append(el('span', 'compare-project-code', project.code), el('h2', '', project.name));
    const metrics = el('div', 'compare-project-metrics');
    metrics.append(el('span', '', `УГТ ${project.ugt_level}`), el('span', '', `${project.completed_stage_count || 0} из ${stages.length} завершено`));
    heading.append(title, metrics, button('Открыть проект ↗', 'compare-project-open', () => openProject(project.public_id)));
    section.append(heading);

    if (!stages.length) {
      section.append(el('p', 'compare-empty', 'В этом проекте пока нет событий.'));
      return section;
    }

    const {points, width, height} = layout(stages);
    const viewport = el('div', 'compare-graph-scroll');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', `Граф проекта «${project.name}». Прокручивается по горизонтали и вертикали.`);
    const surface = el('div', 'compare-graph');
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    const paths = svg('svg', {viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true'});
    stages.forEach(stage => {
      const point = points.get(stage.public_id);
      const parent = points.get(stage.parent_public_id);
      if (!point || !parent) return;
      const bend = Math.max(30, (point.x - parent.x) / 2);
      paths.append(svg('path', {d: `M ${parent.x} ${parent.y} C ${parent.x + bend} ${parent.y}, ${point.x - bend} ${point.y}, ${point.x} ${point.y}`, class: stage.status === 'completed' ? 'is-complete' : ''}));
    });
    surface.append(paths);
    const nodes = [];
    stages.forEach((stage, index) => {
      const point = points.get(stage.public_id);
      if (!point) return;
      const node = el('div', `compare-node compare-node-${stage.status || 'planned'}`);
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      const number = button(String(stage.position || index + 1), 'compare-number', () => {
        nodes.forEach(other => {
          if (other === node) return;
          other.classList.remove('is-open');
          other.querySelector('.compare-number')?.setAttribute('aria-expanded', 'false');
        });
        node.classList.toggle('is-open');
        const open = node.classList.contains('is-open');
        number.setAttribute('aria-expanded', String(open));
        if (open) card.querySelector('.compare-event-close').focus();
      });
      number.setAttribute('aria-label', `D${stage.position || index + 1}: ${stage.title}. ${statusNames[stage.status] || 'Событие'}. Раскрыть карточку`);
      number.setAttribute('aria-expanded', 'false');
      const card = el('article', 'compare-event-card');
      const cardTop = el('div', 'compare-event-top');
      const close = button('×', 'compare-event-close', () => {
        node.classList.remove('is-open');
        number.setAttribute('aria-expanded', 'false');
        number.focus();
      });
      close.setAttribute('aria-label', 'Закрыть карточку события');
      cardTop.append(el('span', '', `D${stage.position || index + 1} · ${statusNames[stage.status] || 'Событие'}`), close);
      const heading = el('h3', '', stage.title || 'Событие без названия');
      const meta = el('div', 'compare-event-meta');
      meta.append(el('span', '', `УГТ ${stage.ugt_level || project.ugt_level || 1}`));
      if (stage.due_at) meta.append(el('span', '', new Date(stage.due_at).toLocaleDateString('ru-RU', {month: 'short', year: 'numeric'})));
      if (stage.progress != null) meta.append(el('span', '', `${stage.progress}%`));
      card.append(cardTop, heading, meta);
      if (stage.description) card.append(el('p', '', stage.description));
      card.append(button('Открыть событие →', 'compare-event-link', () => { location.hash = `event/${project.public_id}/${stage.public_id}`; }));
      node.append(number, card);
      nodes.push(node);
      surface.append(node);
    });
    viewport.append(surface);
    section.append(viewport);
    return section;
  }

  async function render(host, api, openProject) {
    host.className = 'compare-page';
    host.replaceChildren();
    const heading = el('header', 'compare-heading');
    heading.append(el('h1', '', 'Сравнение проектов'), el('p', '', 'Выберите проекты и откройте событие на графе.'));
    const picker = el('div', 'compare-picker');
    const status = el('p', 'compare-status', 'Загружаем проекты…');
    status.setAttribute('role', 'status');
    const graphs = el('div', 'compare-graphs');
    host.append(heading, picker, status, graphs);

    let items;
    try { ({items} = await api('/api/projects')); }
    catch (error) { status.textContent = error.message; return; }
    if (!host.isConnected || host.hidden) return;
    if (!items.length) { status.textContent = 'Пока нет доступных проектов для сравнения.'; return; }

    const selected = new Set(items.slice(0, Math.min(2, items.length)).map(item => item.public_id));
    const cache = new Map();
    let request = 0;
    function updatePicker() {
      picker.querySelectorAll('input').forEach(input => {
        input.checked = selected.has(input.value);
        input.disabled = selected.size >= MAX_PROJECTS && !input.checked;
      });
    }
    async function draw() {
      const current = ++request;
      const chosen = items.filter(item => selected.has(item.public_id));
      graphs.replaceChildren();
      status.textContent = chosen.length ? 'Загружаем графы…' : 'Выберите хотя бы один проект.';
      if (!chosen.length) return;
      const results = await Promise.all(chosen.map(async project => {
        if (cache.has(project.public_id)) return cache.get(project.public_id);
        try {
          const detail = await api(`/api/projects/${encodeURIComponent(project.public_id)}`);
          cache.set(project.public_id, detail);
          return detail;
        } catch (error) { return {error}; }
      }));
      if (current !== request || host.hidden || !host.isConnected) return;
      chosen.forEach((project, index) => {
        const result = results[index];
        graphs.append(result.error ? el('p', 'compare-error', `${project.name}: ${result.error.message}`) : graph(project, result, openProject));
      });
      status.textContent = `${chosen.length} ${chosen.length === 1 ? 'проект' : chosen.length < 5 ? 'проекта' : 'проектов'} · нажмите на номер события, чтобы открыть карточку`;
    }
    items.forEach(project => {
      const label = el('label', 'compare-option');
      const input = el('input');
      input.type = 'checkbox';
      input.value = project.public_id;
      input.addEventListener('change', () => {
        if (input.checked) selected.add(project.public_id);
        else selected.delete(project.public_id);
        updatePicker();
        draw();
      });
      label.append(input, el('span', '', project.name));
      picker.append(label);
    });
    updatePicker();
    await draw();
  }
  return {render, layout};
})();
