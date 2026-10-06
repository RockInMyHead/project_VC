const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const roles = {
  investor: 'Инвестор',
  founder: 'Основатель проекта',
  fund_staff: 'Сотрудник фонда',
  super_admin: 'Главный администратор',
};
const reviewNames={draft:'Подготовка',in_review:'На проверке',published:'Опубликован',rejected:'На доработке'};
const statusNames = { draft: 'Черновик', active: 'Опубликован', paused: 'На паузе', completed: 'Завершён' };
const errorMessages = {
  invalid_credentials: 'Неверный email, телефон или пароль.',
  otp_expired: 'Срок действия кода истёк. Войдите ещё раз, чтобы получить новый код.',
  invalid_otp: 'Код введён неверно. Проверьте цифры и попробуйте снова.',
  unauthorized: 'Сессия завершена. Пожалуйста, войдите снова.',
  forbidden: 'У вашей учётной записи нет доступа к этому разделу.',
  validation_failed: 'Проверьте заполненные поля и попробуйте снова.',
  invalid_request: 'Не удалось обработать данные формы.',
  project_not_found: 'Проект не найден или больше недоступен.',
  not_found: 'Запрошенная страница не найдена.',
};

let challengeId;
let treeStages = [];
let selectedStageId = null;
let nextStageId = 1;
let chatContacts = [];
let activeChatId = null;
let chatRequest = 0;
const chatDrafts=new Map();
let chatSendKey=newRequestKey(),chatSendFingerprint='';
let chatDraftKey=null;
let draftKey=null;
let pendingFounderId='';
let projectRequestKey=newRequestKey();
let projectRequestFingerprint='';
const pendingStageFiles=new Map();
function saveProjectInput(){
  if(!draftKey)return;
  try{sessionStorage.setItem(draftKey,JSON.stringify({fields:Object.fromEntries(new FormData($('#projectForm'))),stages:treeStages,selectedStageId,nextStageId,requestKey:projectRequestKey,fingerprint:projectRequestFingerprint}));}catch{}
}
function restoreProjectInput(){
  try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(!saved)return;for(const [name,value] of Object.entries(saved.fields))if($('#projectForm').elements[name])$('#projectForm').elements[name].value=value;pendingFounderId=saved.fields.founder_id||'';treeStages=saved.stages;selectedStageId=saved.selectedStageId;nextStageId=saved.nextStageId;projectRequestKey=saved.requestKey||newRequestKey();projectRequestFingerprint=saved.fingerprint||'';}catch{}
}
function saveChatInput(){
  if(!chatDraftKey)return;
  if(activeChatId){const body=$('#chatInput').value;if(body)chatDrafts.set(activeChatId,body);else chatDrafts.delete(activeChatId);}
  try{sessionStorage.setItem(chatDraftKey,JSON.stringify({drafts:Object.fromEntries(chatDrafts),requestKey:chatSendKey,fingerprint:chatSendFingerprint}));}catch{}
}
function restoreChatInput(userId){
  chatDrafts.clear();activeChatId=null;$('#chatInput').value='';
  chatDraftKey='bokChatDrafts:'+userId;
  chatSendKey=newRequestKey();chatSendFingerprint='';
  try{const saved=JSON.parse(sessionStorage.getItem(chatDraftKey)||'null');if(!saved)return;for(const [id,body] of Object.entries(saved.drafts||{}))if(typeof body==='string')chatDrafts.set(id,body);chatSendKey=saved.requestKey||chatSendKey;chatSendFingerprint=saved.fingerprint||'';}catch{}
}
window.addEventListener('pagehide',()=>{saveProjectInput();saveChatInput();});
$('#projectForm').addEventListener('input',()=>queueMicrotask(saveProjectInput));
$('#projectForm').addEventListener('change',()=>queueMicrotask(saveProjectInput));
$('#chatInput').addEventListener('input',saveChatInput);

function resetTree() {
  treeStages = [{ id: nextStageId++, parent: null, title: 'Гипотеза и научная база', description: '', status: 'in_progress', ugt_level: 1 }];
  selectedStageId = treeStages[0].id;
  renderTree();
}

function treeLayout(stages = treeStages) {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const children = new Map(stages.map(stage => [stage.id, []]));
  const roots = [];
  stages.forEach(stage => {
    if (stage.parent != null && byId.has(stage.parent)) children.get(stage.parent).push(stage);
    else roots.push(stage);
  });
  const positions = new Map();
  const leafTotal = stages.filter(stage => !(children.get(stage.id) || []).length).length;
  const baseY = leafTotal === 1 ? 142 : 72;
  let leaf = 0, maxDepth = 0;
  const visited = new Set();
  function place(stage, depth) {
    if (visited.has(stage.id)) return null;
    visited.add(stage.id);
    maxDepth = Math.max(maxDepth, depth);
    const childRows = children.get(stage.id).map(child => place(child, depth + 1)).filter(row => row !== null);
    const y = childRows.length ? (childRows[0] + childRows[childRows.length - 1]) / 2 : baseY + leaf++ * 186;
    positions.set(stage.id, { x: 42 + depth * 310, y });
    return y;
  }
  roots.forEach(root => place(root, 0));
  stages.filter(stage => !visited.has(stage.id)).forEach(stage => place(stage, 0));
  return { positions, width: Math.max(740, 42 + maxDepth * 310 + 236 + 56), height: Math.max(420, baseY + Math.max(leaf - 1, 0) * 186 + 136 + 72) };
}

function renderTree() {
  const { positions, width, height } = treeLayout();
  const canvas = $('#treeCanvas');
  const nodes = $('#treeNodes');
  const lines = $('#treeLines');
  nodes.style.width = `${width}px`;
  nodes.style.height = `${height}px`;
  lines.setAttribute('width', width);
  lines.setAttribute('height', height);
  lines.setAttribute('viewBox', `0 0 ${width} ${height}`);
  lines.innerHTML = '';
  nodes.innerHTML = '';
  treeStages.forEach((stage, index) => {
    const point = positions.get(stage.id);
    if (stage.parent !== null && positions.has(stage.parent)) {
      const source = positions.get(stage.parent);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x1 = source.x + 236, y1 = source.y + 62, x2 = point.x, y2 = point.y + 62;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', [stage.status === 'completed' ? 'is-complete' : stage.status === 'in_progress' ? 'is-active' : '', stage.id === selectedStageId ? 'is-selected' : ''].filter(Boolean).join(' '));
      lines.append(path);
    }
    const card = document.createElement('article');
    card.className = `tree-node ${stage.status} ${stage.id === selectedStageId ? 'selected' : ''}`;
    card.style.left = `${point.x}px`;
    card.style.top = `${point.y}px`;
    card.style.animationDelay = `${Math.min(index * 65, 390)}ms`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-node-main';
    const number = document.createElement('small');
    number.textContent = `ЭТАП ${String(index + 1).padStart(2, '0')} · УГТ ${stage.ugt_level}`;
    const title = document.createElement('strong');
    title.textContent = stage.title || 'Новый этап';
    const status = document.createElement('span');
    status.textContent = { planned: 'В плане', in_progress: 'В работе', completed: 'Завершён' }[stage.status];
    button.append(number, title, status);
    button.onclick = (event) => { selectedStageId = stage.id; renderTree(); if(event.detail===0)nodes.querySelector('.tree-node.selected .tree-node-main')?.focus({preventScroll:true}); };
    const branch = document.createElement('button');
    branch.type = 'button';
    branch.className = 'tree-node-branch';
    branch.textContent = '+ Ответвление';
    branch.setAttribute('aria-label', `Добавить ответвление от этапа «${stage.title || 'Новый этап'}»`);
    branch.onclick = () => addTreeStage(stage.id);
    card.append(button, branch);
    nodes.append(card);
  });
  const count = treeStages.length;
  const suffix = count % 100 >= 11 && count % 100 <= 14 ? 'этапов' : count % 10 === 1 ? 'этап' : count % 10 >= 2 && count % 10 <= 4 ? 'этапа' : 'этапов';
  $('#treeCount').textContent = `${count} ${suffix}`;
  const selected = treeStages.find((stage) => stage.id === selectedStageId);
  $('#treeInspector').hidden = !selected;
  if (selected) {
    $('#treeTitle').value = selected.title;
    $('#treeStatus').value = selected.status;
    $('#treeUgt').value = selected.ugt_level;
    $('#treeDescription').value = selected.description;
  }
  renderStageExtras(selected);
  canvas.style.setProperty('--tree-width', `${width}px`);
  canvas.setAttribute('aria-label', `Дерево прогресса: ${count} ${suffix}`);
}

function renderStageExtras(stage){
  const choices=$('#treeChoiceList'),files=$('#treeFileList');
  choices.replaceChildren();files.replaceChildren();
  if(!stage)return;
  stage.choices ||= [];
  if(!stage.choices.length){const empty=document.createElement('p');empty.className='stage-extra-empty';empty.textContent='Добавьте варианты, между которыми можно выбрать один.';choices.append(empty);}
  stage.choices.forEach((value,index)=>{
    const row=document.createElement('div');row.className='stage-choice-row';
    const radio=document.createElement('input');radio.type='radio';radio.checked=stage.selected_choice===index;radio.setAttribute('aria-label',`Выбрать вариант ${index+1}`);
    radio.onchange=()=>{stage.selected_choice=index;renderStageExtras(stage);saveProjectInput();};
    const input=document.createElement('input');input.type='text';input.value=value;input.placeholder=`Вариант ${index+1}`;input.maxLength=200;input.setAttribute('aria-label',`Текст варианта ${index+1}`);
    input.oninput=()=>{stage.choices[index]=input.value;saveProjectInput();};
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Удалить вариант ${index+1}`);
    remove.onclick=()=>{stage.choices.splice(index,1);if(stage.selected_choice===index)stage.selected_choice=stage.choices.length?0:null;else if(stage.selected_choice>index)stage.selected_choice--;renderStageExtras(stage);saveProjectInput();};
    row.append(radio,input,remove);choices.append(row);
  });
  const attached=pendingStageFiles.get(stage.id)||[];
  if(!attached.length){const empty=document.createElement('p');empty.className='stage-extra-empty';empty.textContent='Прикреплённые файлы появятся здесь.';files.append(empty);}
  attached.forEach((file,index)=>{
    const row=document.createElement('div');row.className='stage-file-row';
    const name=document.createElement('span');name.textContent=file.name;name.title=file.name;
    const size=document.createElement('small');size.textContent=file.size>=1_000_000?`${(file.size/1_000_000).toFixed(1)} МБ`:`${Math.max(1,Math.ceil(file.size/1000))} КБ`;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Убрать файл ${file.name}`);
    remove.onclick=()=>{attached.splice(index,1);if(!attached.length)pendingStageFiles.delete(stage.id);renderStageExtras(stage);};
    row.append(name,size,remove);files.append(row);
  });
}

function addTreeStage(parent = null) {
  if (treeStages.length >= 12) { $('#projectMessage').textContent = 'В первом дереве можно добавить до 12 этапов.'; return; }
  const stage = { id: nextStageId++, parent, title: 'Новый этап', description: '', status: 'planned', ugt_level: Number($('#projectForm').elements.ugt_level.value) };
  treeStages.push(stage);
  selectedStageId = stage.id;
  renderTree();
  saveProjectInput();
  const point = treeLayout().positions.get(stage.id);
  const canvas = $('#treeCanvas');
  canvas.scrollTo({left:Math.max(0,point.x - canvas.clientWidth / 2 + 118),top:Math.max(0,point.y - canvas.clientHeight / 2 + 68),behavior:'instant'});
  $('#treeTitle').focus({preventScroll:true});
  $('#treeTitle').select();
}

function friendlyError(code, status) {
  return errorMessages[code] || (status >= 500 ? 'Сервис временно недоступен. Попробуйте немного позже.' : 'Не удалось выполнить действие. Попробуйте ещё раз.');
}

function switchAuth(panel) {
  $$('[data-auth-panel]').forEach((item) => item.classList.toggle('active', item.dataset.authPanel === panel));
  $$('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item.dataset.authTab === panel));
  $('#authMessage').textContent = '';
}

function showAuth(panel = 'login') {
  document.body.classList.remove('project-focus','matrix28-page');
  $('#siteHeader').hidden = true;
  $('#publicPage').hidden = true;
  $('#workspace').hidden = true;
  $('#authPage').hidden = false;
  switchAuth(panel);
  location.hash = 'auth';
}

function closeAuth() {
  $('#siteHeader').hidden = false;
  $('#authPage').hidden = true;
  $('#publicPage').hidden = false;
  location.hash = 'home';
}

async function api(path, options = {}) {
  const token = localStorage.getItem('bokToken');
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error('Нет соединения с сервером. Проверьте интернет и попробуйте снова.');
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Попробуйте немного позже.');
  }
  if (!response.ok) {const error=new Error(data.message || friendlyError(data.error,response.status));error.status=response.status;throw error;}
  return data;
}

function renderProjects(items) {
  const grid = $('#projectGrid');
  grid.replaceChildren();
  const canCreate = ['founder','fund_staff'].includes(document.body.dataset.role);
  grid.classList.toggle('is-empty', !items.length);
  $('#workspace').classList.toggle('has-empty-projects', !items.length);
  if (!items.length) {
    const empty = document.createElement('article');
    empty.className = 'project-empty';
    empty.innerHTML = `<div class="project-empty-copy"><h2>${canCreate ? 'Пока нет проектов' : 'Проекты пока не опубликованы'}</h2><p>${canCreate ? 'Создайте проект и добавьте первые этапы исследования.' : 'Опубликованные проекты появятся здесь после проверки.'}</p>${canCreate ? '<button type="button" class="project-empty-action" data-new-project>Создать проект <span aria-hidden="true">↗</span></button>' : ''}</div>`;
    const createButton = empty.querySelector('[data-new-project]');
    if (createButton) createButton.onclick = openProjectCreatePage;
    grid.append(empty);
    return;
  }
  items.forEach((project) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'project-card project-card-link';
    const meta = document.createElement('span');
    meta.textContent = `${project.code} · ${project.field}`;
    const title = document.createElement('h2');
    title.textContent = project.name;
    const summary = document.createElement('p');
    summary.textContent = project.summary;
    const footer = document.createElement('footer');
    const ugt = document.createElement('b');
    ugt.textContent = `УГТ ${project.ugt_level}`;
    const count = document.createElement('small');
    count.textContent = `${reviewNames[project.review_state] || statusNames[project.status] || project.status} · ${project.completed_stage_count || 0} из ${project.stage_count || 0} этапов`;
    footer.append(ugt, count);
    card.append(meta, title, summary, footer);
    card.onclick = () => openProject(project.public_id);
    grid.append(card);
  });
}

let activityRequest = 0;
function setWorkspaceNav(activeId) {
  for (const id of ['projectsNav','compareNav','messagesNav','notificationsNav','changesNav','profileNav']) {
    const button = $(`#${id}`);
    button.classList.toggle('active', id === activeId);
    if (id === activeId) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
function hideActivityPages() {
  activityRequest++;
  if ($('#comparePage')) $('#comparePage').hidden = true;
  for (const id of ['notificationsPage','changesPage']) {
    const page = $(`#${id}`);
    if (page) page.hidden = true;
  }
}
async function showComparePage() {
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectCreatePage').hidden = true;
  $('#projectGrid').hidden = true;
  $('#messagesPage').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  if ($('#projectDetail')) $('#projectDetail').hidden = true;
  $('#workspace main > header').hidden = true;
  hideActivityPages();
  let page = $('#comparePage');
  if (!page) {
    page = document.createElement('section');
    page.id = 'comparePage';
    $('#workspace main').append(page);
  }
  page.hidden = false;
  setWorkspaceNav('compareNav');
  if (location.hash !== '#compare') location.hash = 'compare';
  await ProjectCompare.render(page, api, openProject);
}
function activityPage(kind, title, description) {
  const id = `${kind}Page`;
  let page = $(`#${id}`);
  if (page) return page;
  page = document.createElement('section');
  page.id = id;
  page.className = 'activity-page';
  page.hidden = true;
  const header = document.createElement('header');
  const heading = document.createElement('div');
  const h1 = document.createElement('h1'); h1.textContent = title;
  const lead = document.createElement('p'); lead.textContent = description;
  heading.append(h1, lead);
  const actions = document.createElement('div'); actions.className = 'activity-actions';
  header.append(heading, actions);
  const status = document.createElement('p'); status.className = 'activity-status'; status.setAttribute('role','status');
  const list = document.createElement('div'); list.className = 'activity-list';
  page.append(header, status, list);
  $('#workspace main').append(page);
  return page;
}
async function showActivityPage(kind) {
  if (kind === 'changes' && document.body.dataset.role !== 'founder') { showProjectList(); return; }
  $('#projectCreatePage').hidden = true;
  const notifications = kind === 'notifications';
  const page = activityPage(kind, notifications ? 'Уведомления' : 'Изменения', notifications ? 'События по вашим проектам и сообщениям.' : 'История действий в доступных вам проектах.');
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectGrid').hidden = true;
  $('#messagesPage').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  $('#workspace main > header').hidden = true;
  if ($('#projectDetail')) $('#projectDetail').hidden = true;
  hideActivityPages();
  page.hidden = false;
  setWorkspaceNav(notifications ? 'notificationsNav' : 'changesNav');
  location.hash = kind;
  const request = ++activityRequest;
  const status = page.querySelector('.activity-status');
  const list = page.querySelector('.activity-list');
  const actions = page.querySelector('.activity-actions');
  status.textContent = 'Загружаем…';
  list.replaceChildren(); actions.replaceChildren();
  if (!notifications) {
    page.querySelectorAll('.commit-more').forEach(button => button.remove());
    const filters = document.createElement('form'); filters.className = 'commit-filters';
    const project = document.createElement('select'); project.setAttribute('aria-label','Проект');
    project.add(new Option('Все проекты',''));
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Поиск по проекту, автору, изменению'; search.setAttribute('aria-label','Поиск изменений');
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Найти';
    filters.append(project,search,submit); actions.append(filters);
    let cursor = null;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'commit-more'; more.textContent = 'Показать ещё'; more.hidden = true;
    page.append(more);
    async function load(reset = true) {
      const current = ++activityRequest;
      if (reset) { cursor = null; list.replaceChildren(); }
      status.textContent = 'Загружаем…'; more.disabled = true; more.hidden = true;
      try {
        const params = new URLSearchParams();
        if (project.value) params.set('project',project.value);
        if (search.value.trim()) params.set('q',search.value.trim());
        if (cursor) params.set('before',cursor);
        const data = await api(`/api/changes?${params}`);
        if (current !== activityRequest || page.hidden) return;
        data.items.forEach(item => list.append(changeCard(item)));
        cursor = data.next_cursor;
        more.hidden = !cursor; more.disabled = false;
        status.textContent = list.children.length ? `${list.children.length} изменений` : 'Изменений не найдено.';
      } catch (error) { if (current === activityRequest) status.textContent = error.message; more.disabled = false; }
    }
    filters.addEventListener('submit',event => { event.preventDefault(); load(); });
    project.addEventListener('change',()=>load());
    more.onclick = () => load(false);
    try {
      const projects = await api('/api/projects');
      if (request !== activityRequest || page.hidden) return;
      projects.items.forEach(item => project.add(new Option(`${item.code} · ${item.name}`,item.public_id)));
      await load();
    } catch (error) { if (request === activityRequest) status.textContent = error.message; }
    return;
  }
  try {
    const data = await api('/api/notifications');
    if (request !== activityRequest || page.hidden) return;
    status.textContent = '';
    if (notifications) {
      const unread = data.items.filter(item => !item.read_at).length;
      if (unread) {
        const readAll = WorkflowUI.btn('Отметить прочитанными', async () => {
          readAll.disabled = true;
          try { await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})}); await showActivityPage('notifications'); }
          catch (error) { status.textContent = error.message; readAll.disabled = false; }
        });
        actions.append(readAll);
      }
      if (!data.items.length) status.textContent = 'Уведомлений пока нет.';
      data.items.forEach(item => {
        const row = document.createElement('article'); row.className = `activity-card ${item.read_at ? '' : 'unread'}`;
        const date = document.createElement('time'); date.textContent = new Date(item.created_at).toLocaleString('ru-RU');
        const title = document.createElement('h2'); title.textContent = item.title;
        const body = document.createElement('p'); body.textContent = item.body;
        row.append(date, title, body);
        if (item.entity_public_id) row.append(WorkflowUI.btn('Открыть проект', async () => {
          try { await api('/api/notifications/read',{method:'POST',body:JSON.stringify({notification_id:item.public_id})}); await openProject(item.entity_public_id); }
          catch (error) { status.textContent = error.message; }
        }));
        list.append(row);
      });
    }
  } catch (error) { if (request === activityRequest) status.textContent = error.message; }
}

function changeCard(item) {
  const node = (tag, className, value) => { const el = document.createElement(tag); if (className) el.className = className; if (value != null) el.textContent = value; return el; };
  const card = node('article','commit-card');
  const head = node('div','commit-head');
  const project = node('button','commit-project',`${item.project_code} · ${item.project_name}`);
  project.type = 'button'; project.onclick = () => openProject(item.project_public_id);
  const id = node('code','commit-id',String(item.public_id || '').replace(/^aud_/, '').slice(0,8)); id.title = `ID изменения: ${item.public_id}`;
  head.append(project,id);
  const title = node('h2','',WorkflowUI.actionTitle(item.action));
  const date = new Date(item.created_at);
  const byline = node('p','commit-byline',`${item.author || 'Система'} · ${Number.isNaN(date.getTime()) ? item.created_at : date.toLocaleString('ru-RU')}`);
  const details = node('details','commit-details'); const summary = node('summary','','Что изменилось'); details.append(summary);
  const diff = node('div','commit-diff');
  let meta = {}; try { meta = JSON.parse(item.metadata_json || '{}') || {}; } catch {}
  const labels = {name:'Название',summary:'Краткое описание',description:'Описание',field:'Область',region:'Регион',ugt_level:'УГТ',status:'Статус',progress:'Готовность',due_at:'Дата',title:'Название этапа',criteria_text:'Критерий завершения',attention_note:'Примечание'};
  const value = input => input == null || input === '' ? '—' : typeof input === 'object' ? JSON.stringify(input) : String(input);
  const line = (kind,text) => diff.append(node('div',`commit-line ${kind}`,text));
  if (meta.changes) for (const [field,change] of Object.entries(meta.changes)) {
    if (field === 'stage') {
      const before = change.before || {}, after = change.after || {};
      line('context',`Этап: ${after.title || before.title || 'без названия'}`);
      for (const key of new Set([...Object.keys(before),...Object.keys(after)])) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        line('removed',`− ${labels[key] || key}: ${value(before[key])}`);
        line('added',`+ ${labels[key] || key}: ${value(after[key])}`);
      }
    } else {
      line('removed',`− ${labels[field] || field}: ${value(change.before)}`);
      line('added',`+ ${labels[field] || field}: ${value(change.after)}`);
    }
  }
  if (Array.isArray(meta.removed)) meta.removed.forEach(stage => line('removed',`− Удалён этап ${stage}`));
  if (meta.remaining_stages != null) line('context',`Осталось этапов: ${meta.remaining_stages}`);
  if (meta.stages != null) line('added',`+ Создано этапов: ${meta.stages}`);
  if (meta.comment || meta.summary) line('context',meta.comment || meta.summary);
  if (!diff.children.length) line('context','Подробности этого изменения не сохранены.');
  details.append(diff); card.append(head,title,byline,details);
  return card;
}

function showProjectList() {
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectCreatePage').hidden = true;
  $('#messagesPage').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  hideActivityPages();
  $('#projectGrid').hidden = false;
  $('#workspace main > header').hidden = false;
  if ($('#projectDetail')) $('#projectDetail').hidden = true;
  setWorkspaceNav('projectsNav');
  location.hash = 'dashboard';
}

function renderProjectDetail(data, eventId=null) {
  $('#projectCreatePage').hidden = true;
  let detail = $('#projectDetail');
  if (!detail) {
    detail = document.createElement('section');
    detail.id = 'projectDetail';
    $('#workspace main').append(detail);
  }
  detail.dataset.projectId=data.project.public_id;
  detail.dataset.eventId=eventId||'';
  if(eventId)EventPage.render(detail,data,eventId);else Matrix28.render(detail, data);
  if(eventId)requestAnimationFrame(()=>window.scrollTo({top:0}));
  $('#projectGrid').hidden = true;
  $('#messagesPage').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  hideActivityPages();
  $('#workspace main > header').hidden = true;
  detail.hidden = false;
  setWorkspaceNav('projectsNav');
  location.hash = eventId?`event/${data.project.public_id}/${eventId}`:`project/${data.project.public_id}`;
}

async function openEventPage(projectId,eventId){
  try{const data=await api(`/api/projects/${encodeURIComponent(projectId)}`);renderProjectDetail(data,eventId);}
  catch(error){$('#toast').textContent=error.message;$('#toast').classList.add('visible');}
}
async function refreshProjectView(projectId){
  const parts=location.hash.slice(1).split('/');
  if(parts[0]==='event'&&parts[1]===projectId)return openEventPage(projectId,parts[2]);
  return openProject(projectId);
}

async function openProject(id) {
  try { renderProjectDetail(await api(`/api/projects/${encodeURIComponent(id)}`)); }
  catch (error) { $('#toast').textContent = error.message; $('#toast').classList.add('visible'); }
}

async function loadProjects() {
  const data = await api('/api/projects');
  renderProjects(data.items);
}

async function enter(user) {
  const requestedProfile = location.hash === '#profile';
  const requestedMessages = location.hash === '#messages';
  const requestedActivity = ['#notifications','#changes'].includes(location.hash) ? location.hash.slice(1) : null;
  const requestedProject = location.hash.startsWith('#project/') ? location.hash.slice(9) : null;
  const requestedEvent = location.hash.startsWith('#event/')?location.hash.slice(7).split('/'):null;
  const requestedCreate = location.hash === '#new-project';
  const requestedCompare = location.hash === '#compare';
  $('#siteHeader').hidden = true;
  $('#publicPage').hidden = true;
  $('#authPage').hidden = true;
  $('#workspace').hidden = false;
  history.replaceState(null,'','#dashboard');
  $('#userName').textContent = user.full_name;
  $('#userRole').textContent = roles[user.role] || user.role;
  document.body.dataset.role = user.role;
  document.body.dataset.userId = user.public_id;
  $('#notificationsNav').hidden = user.role !== 'founder';
  $('#changesNav').hidden = user.role !== 'founder';
  $('#adminBackNav').hidden = user.role !== 'super_admin';
  draftKey='bokProjectDraft:'+user.public_id; restoreProjectInput();
  restoreChatInput(user.public_id);
  let tools=document.querySelector('.workspace-tools');
  if(!tools){tools=document.createElement('div');tools.className='workspace-tools';$('#workspace main > header').append(tools);}
  tools.replaceChildren();
  if(user.role!=='founder') tools.append(WorkflowUI.btn('Уведомления',()=>showActivityPage('notifications')));
  await loadProjects();
  if (requestedProfile) await showProfile();
  else if (requestedCompare) await showComparePage();
  else if (requestedMessages) await showMessages();
  else if (requestedActivity) await showActivityPage(requestedActivity);
  else if (requestedEvent) await openEventPage(requestedEvent[0],requestedEvent[1]);
  else if (requestedProject) await openProject(requestedProject);
  else if (requestedCreate) await openProjectCreatePage();
  updateMessageBadge().catch(() => {});
}

function renderContacts() {
  const list = $('#chatContacts');
  const query = $('#chatSearch').value.trim().toLocaleLowerCase('ru');
  const filtered = chatContacts.filter((contact) => `${contact.full_name} ${contact.organization || ''}`.toLocaleLowerCase('ru').includes(query));
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-contact-empty';
    empty.textContent = chatContacts.length ? 'Никого не нашли' : 'Пока нет других участников платформы';
    list.append(empty);
    return;
  }
  filtered.forEach((contact) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chat-contact ${contact.public_id === activeChatId ? 'active' : ''}`;
    const avatar = document.createElement('span'); avatar.className = 'chat-avatar'; avatar.textContent = contact.full_name.trim().slice(0, 1).toUpperCase();
    const copy = document.createElement('span'); copy.className = 'chat-contact-copy';
    const name = document.createElement('strong'); name.textContent = contact.full_name;
    const sub = document.createElement('small'); sub.textContent = contact.last_message || contact.organization || roles[contact.role] || '';
    copy.append(name, sub);
    button.append(avatar, copy);
    if (contact.unread_count) { const unread = document.createElement('b'); unread.className = 'chat-unread'; unread.textContent = contact.unread_count; button.append(unread); }
    button.onclick = () => openChat(contact.public_id, {reveal: true});
    list.append(button);
  });
}

async function loadContacts() {
  const data = await api('/api/messages/contacts');
  chatContacts = data.items;
  renderContacts();
  const count = chatContacts.reduce((total, contact) => total + contact.unread_count, 0);
  const badge = $('#messageBadge');
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
}

async function updateMessageBadge() {
  if (!$('#workspace').hidden) await loadContacts();
}

async function showProfile() {
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectCreatePage').hidden = true;
  $('#projectGrid').hidden = true;
  $('#messagesPage').hidden = true;
  $('#workspace main > header').hidden = true;
  if ($('#projectDetail')) $('#projectDetail').hidden = true;
  hideActivityPages();
  let page = $('#profilePage');
  if (!page) { page = document.createElement('section'); page.id='profilePage'; $('#workspace main').append(page); }
  page.hidden = false;
  page.textContent = 'Загружаем личный кабинет…';
  setWorkspaceNav('profileNav');
  if (location.hash !== '#profile') location.hash = 'profile';
  try {
    const data = await api('/api/profile');
    if (page.hidden) return;
    ProfilePage.render(page,data,api,updated=>{$('#userName').textContent=updated.full_name;});
  } catch(error) { if (!page.hidden) page.textContent=error.message; }
}

async function showMessages() {
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectCreatePage').hidden = true;
  $('#projectGrid').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  hideActivityPages();
  $('#workspace main > header').hidden = true;
  $('#projectDetail') && ($('#projectDetail').hidden = true);
  $('#messagesPage').hidden = false;
  setMobileChatView('list');
  setWorkspaceNav('messagesNav');
  location.hash = 'messages';
  try {
    await loadContacts();
    if (activeChatId) await openChat(activeChatId);
  } catch (error) {
    $('#chatMessage').textContent = error.message;
  }
}

function setMobileChatView(view) {
  $('#messagesPage .messenger').dataset.mobileView = view;
}

async function openChat(id, {reveal = false} = {}) {
  if(activeChatId!==id){if(activeChatId){const body=$('#chatInput').value;if(body)chatDrafts.set(activeChatId,body);else chatDrafts.delete(activeChatId);}$('#chatInput').value=chatDrafts.get(id)||'';}
  activeChatId = id;
  saveChatInput();
  const request = ++chatRequest;
  $('#chatMessage').textContent = '';
  renderContacts();
  try {
    const data = await api(`/api/messages/${encodeURIComponent(id)}`);
    if (request !== chatRequest) return;
    const head = $('#chatConversationHead');
    const back = $('#chatBack');
    const name = document.createElement('strong'); name.textContent = data.contact.full_name;
    const organization = document.createElement('span'); organization.textContent = data.contact.organization || 'Участник платформы';
    const identity = document.createElement('div'); identity.className = 'chat-conversation-identity';
    identity.append(name, organization);
    head.replaceChildren(back, identity);
    const history = $('#chatHistory');
    history.replaceChildren();
    if (!data.items.length) {
      const empty = document.createElement('div'); empty.className = 'chat-empty'; empty.textContent = 'Переписка пока пуста. Напишите первое сообщение.'; history.append(empty);
    }
    data.items.forEach((message) => {
      const bubble = document.createElement('div'); bubble.className = `chat-bubble ${message.own ? 'own' : ''}`;
      const body = document.createElement('p'); body.textContent = message.body;
      const time = document.createElement('time'); time.textContent = new Date(message.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      bubble.append(body, time); history.append(bubble);
    });
    history.scrollTop = history.scrollHeight;
    $('#chatInput').disabled = false;
    $('#chatForm button[type="submit"]').disabled = false;
    if (reveal) setMobileChatView('conversation');
    await loadContacts();
  } catch (error) {
    $('#chatMessage').textContent = error.message;
  }
}

async function openProjectCreatePage() {
  if (!['founder','fund_staff'].includes(document.body.dataset.role)) return showProjectList();
  document.body.classList.remove('project-focus','matrix28-page');
  $('#projectGrid').hidden = true;
  $('#messagesPage').hidden = true;
  if ($('#profilePage')) $('#profilePage').hidden = true;
  $('#workspace main > header').hidden = true;
  if ($('#projectDetail')) $('#projectDetail').hidden = true;
  hideActivityPages();
  $('#projectCreatePage').hidden = false;
  setWorkspaceNav('projectsNav');
  if (location.hash !== '#new-project') location.hash = 'new-project';
  $('#projectMessage').textContent = '';
  const founderField=$('#projectFounderField'),founderSelect=founderField.querySelector('select');
  const staff=document.body.dataset.role==='fund_staff';
  founderField.hidden=!staff;founderSelect.disabled=!staff;
  if(staff){
    try{
      const {items}=await api('/api/founders');
      founderSelect.replaceChildren(new Option('Выберите основателя',''),...items.map(x=>new Option(x.full_name+(x.organization?' · '+x.organization:''),x.public_id)));
      founderSelect.value=pendingFounderId;pendingFounderId='';
      if(!items.length)$('#projectMessage').textContent='Сначала администратор должен создать учётную запись основателя.';
    }catch(error){$('#projectMessage').textContent=error.message;return;}
  }
  if (!treeStages.length) resetTree();
  else renderTree();
  window.scrollTo({top:0,behavior:'instant'});
}

function closeProjectCreatePage(navigate=true) {
  saveProjectInput();
  $('#projectCreatePage').hidden = true;
  if (navigate) showProjectList();
}

$$('[data-open-auth]').forEach((item) => { item.onclick = () => showAuth(); });
$$('[data-open-auth-register]').forEach((item) => { item.onclick = () => showAuth('register'); });
$('[data-close-auth]').onclick = closeAuth;
$$('[data-auth-tab]').forEach((item) => { item.onclick = () => switchAuth(item.dataset.authTab); });
$('#yandexDemoButton').onclick = () => { $('#yandexDemoForm').hidden = true; $('#yandexDemoSuccess').hidden = true; $('#yandexDemoContinue').hidden = false; $('#yandexDemoDialog').showModal(); };
$('#yandexDemoClose').onclick = () => $('#yandexDemoDialog').close();
$('#yandexDemoContinue').onclick = () => { $('#yandexDemoContinue').hidden = true; $('#yandexDemoForm').hidden = false; };
$('#yandexDemoForm').onsubmit = (event) => { event.preventDefault(); $('#yandexDemoForm').hidden = true; $('#yandexDemoSuccess').hidden = false; };
$('#yandexDemoDialog').onclick = (event) => { if (event.target.id === 'yandexDemoDialog') event.target.close(); };
$$('[data-close-project]').forEach((item) => { item.onclick = () => closeProjectCreatePage(); });
const newProjectButton = $('[data-new-project]');
if (newProjectButton) newProjectButton.onclick = openProjectCreatePage;
$('#projectsNav').onclick = showProjectList;
$('#compareNav').onclick = showComparePage;
$('#messagesNav').onclick = showMessages;
$('#profileNav').onclick = showProfile;
$('#adminBackNav').onclick = () => { location.href='./admin.html'; };
$('#notificationsNav').onclick = () => showActivityPage('notifications');
$('#changesNav').onclick = () => showActivityPage('changes');
$('#chatSearch').oninput = renderContacts;
$('#chatBack').onclick = () => setMobileChatView('list');
$('#chatForm').onsubmit = async (event) => {
  event.preventDefault();
  const input = $('#chatInput');
  const body = input.value.trim();
  if (!activeChatId || !body) return;
  const button = $('#chatForm button[type="submit"]');
  button.disabled = true;
  $('#chatMessage').textContent = '';
  try {
    const fingerprint=activeChatId+':'+body;if(fingerprint!==chatSendFingerprint){chatSendKey=newRequestKey();chatSendFingerprint=fingerprint;}saveChatInput();
    await api('/api/messages', { method: 'POST', body: JSON.stringify({ recipient_id: activeChatId, body, request_key:chatSendKey }) });
    chatDrafts.delete(activeChatId);chatSendFingerprint='';
    input.value = '';
    saveChatInput();
    await openChat(activeChatId);
  } catch (error) {
    $('#chatMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$('#chatInput').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chatForm').requestSubmit(); }
};
setInterval(() => {
  if ($('#workspace').hidden) return;
  if (!$('#messagesPage').hidden && activeChatId && document.visibilityState === 'visible') openChat(activeChatId);
  else updateMessageBadge().catch(() => {});
}, 10000);
$('#treeAddRoot').onclick = () => addTreeStage();
$('#treeAddChild').onclick = () => addTreeStage(selectedStageId);
$('#treeAddChoice').onclick=()=>{
  const stage=treeStages.find(item=>item.id===selectedStageId);
  if(!stage)return;
  stage.choices ||= [];
  if(stage.choices.length>=12){$('#projectMessage').textContent='Для этапа можно добавить до 12 вариантов.';return;}
  stage.choices.push('');
  if(stage.selected_choice==null)stage.selected_choice=0;
  renderStageExtras(stage);saveProjectInput();
  $('#treeChoiceList .stage-choice-row:last-child input[type=text]')?.focus();
};
$('#treeFiles').onchange=event=>{
  const stage=treeStages.find(item=>item.id===selectedStageId);
  if(!stage)return;
  const attached=pendingStageFiles.get(stage.id)||[];
  for(const file of event.target.files){
    if(file.size>50_000_000){$('#projectMessage').textContent=`Файл «${file.name}» больше 50 МБ.`;continue;}
    if(!file.size){$('#projectMessage').textContent=`Файл «${file.name}» пустой.`;continue;}
    if(attached.length>=8){$('#projectMessage').textContent='К одному этапу можно прикрепить до 8 файлов.';break;}
    attached.push(file);
  }
  if(attached.length)pendingStageFiles.set(stage.id,attached);
  event.target.value='';renderStageExtras(stage);
};
const treeNavigation = document.createElement('div');
treeNavigation.className = 'tree-navigation';
const treeBack = document.createElement('button');
treeBack.type = 'button'; treeBack.textContent = '←'; treeBack.setAttribute('aria-label','Прокрутить дерево влево');
const treeForward = document.createElement('button');
treeForward.type = 'button'; treeForward.textContent = '→'; treeForward.setAttribute('aria-label','Прокрутить дерево вправо');
treeNavigation.append(treeBack,treeForward);
$('.tree-toolbar').append(treeNavigation);
treeBack.onclick = () => $('#treeCanvas').scrollBy({left:-310,behavior:'instant'});
treeForward.onclick = () => $('#treeCanvas').scrollBy({left:310,behavior:'instant'});
$('#treeDelete').onclick = () => {
  const removed = selectedStageId;
  const stage = treeStages.find((item) => item.id === removed);
  if (!stage || treeStages.length === 1) return;
  treeStages.forEach((item) => { if (item.parent === removed) item.parent = stage.parent; });
  treeStages = treeStages.filter((item) => item.id !== removed);
  pendingStageFiles.delete(removed);
  selectedStageId = stage.parent || treeStages[0].id;
  renderTree();
  const point = treeLayout().positions.get(selectedStageId);
  if (point) $('#treeCanvas').scrollTo({left:Math.max(0,point.x - 42),top:Math.max(0,point.y - 72),behavior:'instant'});
  saveProjectInput();
};
for (const [selector, property] of [['#treeTitle', 'title'], ['#treeStatus', 'status'], ['#treeUgt', 'ugt_level'], ['#treeDescription', 'description']]) {
  $(selector).addEventListener(selector === '#treeTitle' || selector === '#treeDescription' ? 'input' : 'change', (event) => {
    const stage = treeStages.find((item) => item.id === selectedStageId);
    if (!stage) return;
    stage[property] = property === 'ugt_level' ? Number(event.target.value) : event.target.value;
    if (selector === '#treeTitle') $('#treeNodes .tree-node.selected strong').textContent = stage.title || 'Новый этап';
    else if (selector !== '#treeDescription') renderTree();
  });
}

$('#loginForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    if (data.token) {
      localStorage.setItem('bokToken', data.token);
      if (data.user.role === 'super_admin') return location.replace('./admin.html');
      await enter(data.user);
    } else {
      challengeId = data.challenge_id;
      switchAuth('otp');
    }
  } catch (error) {
    $('#authMessage').textContent = error.message;
  }
};

$('#otpForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ challenge_id: challengeId, code: new FormData(event.currentTarget).get('code') }) });
    localStorage.setItem('bokToken', data.token);
    if (data.user.role === 'super_admin') return location.replace('./admin.html');
    await enter(data.user);
  } catch (error) {
    $('#authMessage').textContent = error.message;
  }
};

$('#registerForm').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (data.password !== data.password_confirm) { $('#authMessage').textContent = 'Пароли не совпадают.'; return; }
    delete data.password_confirm;
    data.requested_role = 'founder';
    await api('/api/registration-requests', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    $('#authMessage').textContent = 'Заявка отправлена. После одобрения войдите с вашим email и паролем.';
  } catch (error) {
    $('#authMessage').textContent = error.message;
  }
};

$('#projectForm').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button.primary');
  const data = Object.fromEntries(new FormData(form));
  data.stages = treeStages.map((stage) => ({ ...stage, title: stage.title.trim(), description: stage.description.trim(),choices:(stage.choices||[]).map(choice=>choice.trim()),selected_choice:stage.selected_choice??null }));
  if(data.stages.some(stage=>stage.choices.some(choice=>!choice))){$('#projectMessage').textContent='Заполните все варианты выбора или удалите пустые.';return;}
  const fingerprint=JSON.stringify(data);if(fingerprint!==projectRequestFingerprint){projectRequestKey=newRequestKey();projectRequestFingerprint=fingerprint;}data.request_key=projectRequestKey;saveProjectInput();
  if (data.stages.some((stage) => !stage.title)) { $('#projectMessage').textContent = 'У каждого этапа должно быть название.'; return; }
  submit.disabled = true;
  $('#projectMessage').textContent = 'Создаём проект...';
  try {
    const result = await api('/api/projects', { method: 'POST', body: JSON.stringify(data) });
    const failedFiles=[];
    for(const [clientId,files] of pendingStageFiles){
      const stageId=result.project.stage_ids?.[String(clientId)];
      for(const file of files){
        $('#projectMessage').textContent=`Загружаем «${file.name}»…`;
        try{if(!stageId)throw new Error('Не найден этап.');await WorkflowUI.uploadMaterial(result.project.public_id,stageId,file);}
        catch{failedFiles.push(file.name);}
      }
    }
    form.reset();
    treeStages=[];pendingFounderId='';pendingStageFiles.clear();projectRequestKey=newRequestKey();projectRequestFingerprint='';
    closeProjectCreatePage(false);
    if(draftKey)sessionStorage.removeItem(draftKey);
    await openProject(result.project.public_id);
    loadProjects().catch(() => {});
    if(failedFiles.length){$('#toast').textContent=`Проект создан, но не загрузились файлы: ${failedFiles.join(', ')}. Их можно добавить в разделе «Материалы».`;$('#toast').classList.add('visible');}
  } catch (error) {
    $('#projectMessage').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};

$('#projectForm').addEventListener('invalid', (event) => {
  const label = event.target.closest('label');
  $('#projectMessage').textContent = `Заполните поле «${label?.firstChild?.textContent?.trim() || 'обязательное поле'}».`;
}, true);

$('#logoutButton').onclick = async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    if(draftKey)sessionStorage.removeItem(draftKey);draftKey=null;
    if(chatDraftKey)sessionStorage.removeItem(chatDraftKey);chatDraftKey=null;chatDrafts.clear();
    for(const key of Object.keys(sessionStorage))if(key.startsWith(`bokWorkflowDraft:${document.body.dataset.userId}:`))sessionStorage.removeItem(key);
    delete document.body.dataset.userId;
    localStorage.removeItem('bokToken');
    location.replace('./index.html');
  }
};

async function restore() {
  if (!localStorage.getItem('bokToken')) return;
  try {
    const { user } = await api('/api/auth/me');
    if (user.role === 'super_admin' && !location.hash.startsWith('#project/')&&!location.hash.startsWith('#event/')&&!['#profile','#messages'].includes(location.hash)) return location.replace('./admin.html');
    await enter(user);
  } catch(error) {
    if(error.status===401){localStorage.removeItem('bokToken');showAuth();}
    $('#toast').textContent=error.message;$('#toast').classList.add('visible');
  }
}

window.addEventListener('hashchange',()=>{
  if(location.hash==='#auth'){showAuth();return;}
  if($('#workspace').hidden)return;
  const hash=location.hash;
  if(hash==='#dashboard'){showProjectList();loadProjects().catch(error=>{$('#toast').textContent=error.message;$('#toast').classList.add('visible');});}
  else if(hash==='#compare'&&$('#comparePage')?.hidden!==false)showComparePage();
  else if(hash==='#new-project'&&$('#projectCreatePage').hidden)openProjectCreatePage();
  else if(hash==='#messages'&&$('#messagesPage').hidden)showMessages();
  else if(hash==='#profile'&&$('#profilePage')?.hidden!==false)showProfile();
  else if(hash==='#notifications'&&$('#notificationsPage')?.hidden!==false)showActivityPage('notifications');
  else if(hash==='#changes'&&$('#changesPage')?.hidden!==false)showActivityPage('changes');
  else if(hash.startsWith('#event/')){const [pid,sid]=hash.slice(7).split('/');if($('#projectDetail')?.hidden||$('#projectDetail')?.dataset.projectId!==pid||$('#projectDetail')?.dataset.eventId!==sid)openEventPage(pid,sid);}
  else if(hash.startsWith('#project/')&&($('#projectDetail')?.hidden||$('#projectDetail')?.dataset.eventId||$('#projectDetail')?.dataset.projectId!==hash.slice(9)))openProject(hash.slice(9));
});
if (location.hash === '#auth') showAuth();
restore();
