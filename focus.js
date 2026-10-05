/* Project view translated from the supplied 1920 × 1430 KUMA30 SVG. */
const FocusProject = (() => {
  const names = { planned: 'В плане', in_progress: 'В работе', completed: 'Завершён' };
  const levels = ['Основные принципы', 'Концепция технологии', 'Доказательство концепции', 'Проверка в лаборатории', 'Проверка в близких к реальным условиях', 'Демонстрация прототипа', 'Пилотное применение', 'Завершённая технология', 'Подтверждение в эксплуатации'];
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const button = (text, cls, action) => { const node = el('button', cls, text); node.type = 'button'; node.onclick = action; return node; };
  const date = (value) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'Не назначена';
  function render(host, data) {
    const { project, stages } = data;
    document.body.classList.add('project-focus');
    host.className = 'focus-project';
    host.replaceChildren();
    let selected = stages.find(s => s.status === 'in_progress') || stages[0];
    let focusDate = new Date();
    const brandRow = el('div', 'focus-brand-row');
    brandRow.append(button('Бок о бок', 'focus-brand', showProjectList), el('span', '', project.code));
    const header = el('header', 'focus-header');
    const identity = el('div', 'focus-identity');
    identity.append(el('h1', '', project.name), el('p', '', project.summary), el('small','focus-muted', `Актуализация: ${date(project.last_published_at || project.updated_at)} · ${project.last_published_at ? 'Опубликованные данные' : 'Рабочая версия'}`));
    const nav = el('nav', 'focus-tabs'); nav.setAttribute('aria-label', 'Разделы проекта');
    const actions = el('div', 'focus-actions');
    const share = button('Поделиться', 'focus-secondary', async () => {
      try { await navigator.clipboard.writeText(location.href); share.textContent = 'Ссылка скопирована'; }
      catch { share.textContent = 'Ссылка в адресной строке'; }
      setTimeout(() => { share.textContent = 'Поделиться'; }, 2500);
    });
    actions.append(share);
    if (data.can_edit) actions.append(button('+ Добавить событие', 'focus-primary', () => WorkflowUI.stage(data)));
    header.append(identity, nav, actions);
    const content = el('div', 'focus-content');
    const alternate = el('section', 'focus-alternate'); alternate.hidden = true;
    const main = el('div', 'focus-main');
    const graph = el('div', 'focus-graph'); graph.tabIndex=0;graph.setAttribute('aria-label','Дерево решений. На узком экране прокручивается по горизонтали.');
    const card = el('section', 'focus-event'); card.setAttribute('aria-live', 'polite');
    main.append(graph, card);
    const readiness = el('section', 'focus-readiness');
    const readyHead = el('div', 'focus-section-heading');
    readyHead.append(el('h2', '', 'УГТ · Готовность продукта'), el('span', '', `Текущий уровень: ${project.ugt_level}`));
    const steps = el('div', 'focus-ugt-steps');
    const readyNote = el('div', 'focus-ugt-note', levels[project.ugt_level - 1]);
    for (let level = 1; level <= 9; level++) {
      const step = button(String(level), level === project.ugt_level ? 'current' : '', () => { readyNote.textContent = `УГТ ${level} · ${levels[level - 1]}`; });
      step.setAttribute('aria-label', `УГТ ${level}: ${levels[level - 1]}`);
      if (level === project.ugt_level) step.setAttribute('aria-current', 'step');
      steps.append(step);
    }
    const groups = el('div', 'focus-ugt-groups'); ['Исследование', 'Проверка технологии', 'Пилот и применение'].forEach(t => groups.append(el('span', '', t)));
    readiness.append(readyHead, steps, groups, readyNote);
    const timeline = el('section', 'focus-timeline');
    const timeHead = el('div', 'focus-section-heading');
    const timeTitle = el('h2');
    const slider = el('input', 'focus-time-slider'); slider.type = 'range'; slider.min = '-365'; slider.max = '365'; slider.value = '0'; slider.setAttribute('aria-label', 'Дата фокуса дерева');
    const ticks = el('div', 'focus-time-ticks');
    const captions = el('div', 'focus-time-captions');
    ['Прошлое сжато', 'Текущие исследования — подробно', 'Будущее сжато'].forEach(t => captions.append(el('span', '', t)));
    function updateTime() {
      timeTitle.textContent = `Фокус: ${focusDate.toLocaleDateString('ru-RU', {month:'long', year:'numeric'})}`;
      ticks.replaceChildren();
      const values = [new Date(focusDate.getFullYear()-2, 0, 1), new Date(focusDate.getFullYear()-1, 0, 1), new Date(focusDate.getFullYear(),focusDate.getMonth()-1,1), new Date(focusDate.getFullYear(),focusDate.getMonth(),1),focusDate,new Date(focusDate.getFullYear(),focusDate.getMonth()+1,0),new Date(focusDate.getFullYear()+1,0,1),new Date(focusDate.getFullYear()+2,0,1)];
      values.forEach((d, i) => ticks.append(el('span', '', [0,1,6,7].includes(i) ? String(d.getFullYear()) : date(d))));
      drawGraph();
    }
    timeHead.append(timeTitle, button('Сегодня', 'focus-secondary', () => { focusDate = new Date(); slider.value = '0'; updateTime(); }));
    slider.oninput = () => { focusDate = new Date(); focusDate.setDate(focusDate.getDate() + Number(slider.value)); updateTime(); };
    timeline.append(timeHead, slider, ticks, captions);
    content.append(main, readiness, timeline);
    host.append(brandRow, header); WorkflowUI.controls(host,data); host.append(content,alternate);
    ['Дерево решений', 'Материалы', 'Команда', 'История', 'О проекте', ...(data.can_ask || data.can_review ? ['Вопросы'] : [])].forEach((title, index) => {
      const tab = button(title, index === 0 ? 'active' : '', () => {
        [...nav.children].forEach(n => n.classList.toggle('active', n === tab));
        content.hidden = index !== 0; alternate.hidden = index === 0;
        alternate.replaceChildren(el('h2', '', title));
        if (index === 1) WorkflowUI.materials(alternate,data);
        if (index === 2) WorkflowUI.team(alternate,data);
        if (index === 3) WorkflowUI.history(alternate,data);
        if (index === 4) { alternate.append(el('p','focus-info-row',project.description),el('p','focus-muted', `${project.field} · ${project.region||'Регион не указан'}`)); }
        if (index === 5) WorkflowUI.questions(alternate,data);
      });
      nav.append(tab);
    });
    function drawCard() {
      card.replaceChildren();
      if (!selected) { card.append(el('h2', '', 'Событий пока нет'), el('p', 'focus-muted', 'Добавьте первое событие в дерево проекта.')); return; }
      card.append(el('span', 'focus-kicker', `СОБЫТИЕ D${selected.position}`), el('h2', '', selected.title), el('span', `focus-status ${selected.status}`, names[selected.status]));
      const goal = el('div', 'focus-goal'); goal.append(el('span', 'focus-kicker', 'ЦЕЛЬ ЭТАПА'), el('p', '', selected.description || 'Цель этапа пока не заполнена.'));
      const meta = el('dl', 'focus-event-meta');
      [['Ответственный', selected.owner_name || 'Не назначен'], ['Контрольная дата', date(selected.due_at)]].forEach(([key,value]) => { meta.append(el('dt', '', key), el('dd', '', value)); });
      const progress = el('div', 'focus-event-progress'); const progressHead = el('div', 'focus-section-heading'); progressHead.append(el('h3', '', 'Готовность этапа'), el('span', '', `${selected.progress}%`));
      const meter = el('progress'); meter.max = 100; meter.value = selected.progress; meter.setAttribute('aria-label','Готовность этапа'); progress.append(progressHead,meter,el('p', 'focus-muted', `УГТ ${selected.ugt_level || project.ugt_level} · ${names[selected.status]}`));
      const materials = el('div', 'focus-event-materials'); materials.append(el('h3', '', 'Материалы'));
      const docs = (data.materials || []).filter(m => m.stage_public_id === selected.public_id);
      if (!docs.length) materials.append(el('p', 'focus-muted', 'Материалы пока не добавлены'));
      docs.forEach(m => materials.append(el('p', '', m.title)));
      card.append(goal,meta,progress,materials,button('Открыть событие', 'focus-primary focus-open-event', () => {
        const dialog = el('dialog', 'focus-dialog');
        dialog.append(button('×', 'focus-dialog-close', () => dialog.close()), el('span','focus-kicker',`СОБЫТИЕ D${selected.position}`),el('h2','',selected.title),el('p','',selected.description || 'Описание пока не заполнено.'),el('p','focus-muted',`${names[selected.status]} · УГТ ${selected.ugt_level} · ${selected.progress}%`));
        host.append(dialog); dialog.onclose = () => dialog.remove(); dialog.showModal();
      }));
      WorkflowUI.stageActions(card,data,selected);
    }
    function drawGraph() {
      graph.replaceChildren();
      const top = el('div', 'focus-eras');
      [['ПРОШЛОЕ', 'Завершённые этапы'], ['ТЕКУЩИЕ ИССЛЕДОВАНИЯ', focusDate.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})], ['БУДУЩЕЕ','План развития']].forEach(([title,sub]) => {const block = el('div'); block.append(el('b','',title),el('span','',sub)); top.append(block);});
      const canvas = el('div', 'focus-map');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox','0 0 1416 635'); svg.setAttribute('preserveAspectRatio','none'); svg.setAttribute('aria-hidden','true');
      const lane = el('div', 'focus-lane'); canvas.append(lane, svg);
      const buckets = [[],[],[]];
      stages.forEach(s => {
        const dated = s.completed_at || s.due_at;
        const delta = dated ? (new Date(dated) - focusDate) / 86400000 : null;
        const column = delta !== null ? (delta < -16 ? 0 : delta > 16 ? 2 : 1) : s.status === 'completed' ? 0 : s.status === 'in_progress' ? 1 : 2;
        buckets[column].push(s);
      });
      const points = new Map();
      canvas.style.minHeight = `${Math.max(460, ...buckets.map(list => list.length * 140 + 100))}px`;
      buckets.forEach((list,col) => list.forEach((s,i) => points.set(s.public_id,{x:[290,602,1090][col],y:150+(i+1)*350/(list.length+1),col})));
      const root = {x:104,y:310};
      const link = (a,b,active) => {const p = document.createElementNS('http://www.w3.org/2000/svg','path'); const bend = Math.max(65,Math.abs(b.x-a.x)*.52); p.setAttribute('d',`M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`); p.setAttribute('class', active ? 'active' : ''); svg.append(p);};
      stages.forEach(s => {
        const pt = points.get(s.public_id); const parent = points.get(s.parent_public_id) || root;
        link(parent,pt,s.status === 'in_progress' || s.public_id === selected?.public_id);
      });
      const origin = el('div','focus-root'); origin.style.left = `${root.x/1416*100}%`; origin.style.top = `${root.y/635*100}%`; origin.append(el('span','','0'),el('strong','',project.code),el('small','',`${stages.length} ${stages.length === 1 ? 'событие' : stages.length < 5 ? 'события' : 'событий'}`)); canvas.append(origin);
      stages.forEach(s => {
        const pt = points.get(s.public_id);
        const node = button('',`focus-node ${s.status} ${s.public_id === selected?.public_id ? 'selected' : ''}`,()=>{ selected=s;drawGraph();drawCard(); });
        node.style.left = `${pt.x/1416*100}%`; node.style.top = `${pt.y/635*100}%`;
        node.setAttribute('aria-label',`${s.title}, ${names[s.status]}`);
        node.append(el('span','focus-dot',`D${s.position}`));
        const label = el('span','focus-node-label'); label.append(el('strong','',s.title),el('small','',`${names[s.status]} · ${s.progress}%`));
        if (s.due_at) label.append(el('small','',date(s.due_at)));
        node.append(label); canvas.append(node);
      });
      graph.append(top,canvas,el('p','focus-map-note','Линии показывают структуру решений. Сроки — на календаре ниже.'));
    }
    updateTime(); drawCard();
  }
  return { render };
})();
