const $=(s,p=document)=>p.querySelector(s),$$=(s,p=document)=>[...p.querySelectorAll(s)];let users=[],registrations=[],projects=[],audit=[],auditCursor=null,auditShown=0,auditRequest=0;
document.getElementById('adminProfile').onclick=()=>{location.href='./index.html#profile';};
document.getElementById('adminMessages').onclick=()=>{location.href='./index.html#messages';};
const roleNames={investor:'Инвестор',founder:'Основатель проекта',fund_staff:'Сотрудник фонда',super_admin:'Главный администратор'};
const accessNames={active:'Активен',blocked:'Заблокирован',archived:'В архиве',invited:'Приглашён',pending:'Ожидает решения',approved:'Одобрена',rejected:'Отклонена'};
const {el,btn,dialog,run}=WorkflowUI;
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('bokToken')}`}});const data=await response.json();if(response.status===401){localStorage.removeItem('bokToken');location.replace('./index.html#auth');}if(!response.ok)throw new Error(data.message||'Не удалось выполнить действие.');return data;}
function toast(message){$('#adminToast').textContent=message;$('#adminToast').classList.add('is-visible');setTimeout(()=>$('#adminToast').classList.remove('is-visible'),4000);}
function showSection(name){$$('.admin-view').forEach(v=>v.classList.toggle('is-active',v.dataset.view===name));$$('[data-section]').forEach(b=>b.classList.toggle('is-active',b.dataset.section===name));$('#sectionTitle').textContent=({overview:'Обзор платформы',users:'Пользователи',registrations:'Заявки на регистрацию',projects:'Все проекты',audit:'Аудит действий',system:'Состояние системы',logs:'Логи приложения'})[name];if(name==='logs')loadLogs();if(name==='audit')loadAudit(true).catch(e=>toast(e.message));if(name==='system')loadSystemActivity();}
async function post(action,data,key){await api('/api/admin/'+action,{method:'POST',body:JSON.stringify({...data,request_key:key})});await refresh();}
const credentials=[{name:'phone',label:'Телефон основателя',type:'tel',placeholder:'+79991234567',autocomplete:'off',pattern:'\\+[1-9][0-9]{9,14}',required:true},{name:'password',label:'Пароль для первого входа',type:'password',placeholder:'Не менее 12 символов',autocomplete:'new-password',minLength:12,required:true}];
function createUser(){dialog('Создать пользователя',[{name:'full_name',label:'Имя и фамилия',required:true},{name:'email',label:'Email',type:'email',required:true},{name:'organization',label:'Организация',required:true},{name:'role',label:'Роль',options:Object.entries(roleNames)},...credentials],(v,k)=>post('users',v,k),'Создать');}
function userCard(u){
  const d=dialog(u.full_name,[
    {name:'full_name',label:'Имя',value:u.full_name,required:true},
    {name:'email',label:'Email',type:'email',value:u.email,required:true},
    {name:'phone',label:'Телефон',type:'tel',value:u.phone||''},
    {name:'organization',label:'Организация',value:u.organization||''},
    {name:'role',label:'Роль',value:u.role_code,options:Object.entries(roleNames)},
    {name:'status',label:'Доступ',value:u.status,options:[['active','Активен'],['blocked','Заблокирован'],['archived','В архиве']]},
    {name:'password',label:'Новый пароль',type:'password',autocomplete:'new-password',minLength:12}
  ],(v,k)=>post('user-update',{...v,user_id:u.public_id},k),'Сохранить изменения');
  d.classList.add('admin-user-dialog');
  const close=d.firstElementChild;close.textContent='×';close.classList.add('admin-user-close');close.setAttribute('aria-label','Закрыть карточку');
  const form=d.querySelector('form'),title=form.querySelector('h2');
  const header=el('header',undefined,'admin-user-header');
  const initials=u.full_name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const avatar=el('span',initials,'admin-user-avatar');avatar.setAttribute('aria-hidden','true');
  const identity=el('div',undefined,'admin-user-identity');identity.append(title,el('p',u.email));
  const status=el('span',accessNames[u.status]||u.status,`admin-user-status admin-user-status-${u.status}`);
  header.append(avatar,identity,status);
  const dates=el('div',undefined,'admin-user-dates');
  for(const [label,value] of [['Создан',u.created_at],['Последний вход',u.last_login_at]]){
    const item=el('div');item.append(el('span',label),el('strong',value?new Date(value).toLocaleString('ru-RU'):'Пока не входил'));dates.append(item);
  }
  const labels=new Map([...form.querySelectorAll(':scope > label')].map(label=>[label.querySelector('[name]').name,label]));
  const fields=el('section',undefined,'admin-user-section admin-user-fields');fields.append(el('h3','Данные пользователя'));
  for(const name of ['full_name','email','phone','organization'])fields.append(labels.get(name));
  const access=el('section',undefined,'admin-user-section admin-user-access');access.append(el('h3','Доступ'));
  for(const name of ['role','status'])access.append(labels.get(name));
  const password=labels.get('password');password.append(el('small','Заполняйте только при смене пароля.'));access.append(password);
  form.prepend(header,dates,fields,access);
  if(u.relationships?.length){const projects=el('div',undefined,'admin-user-projects');projects.append(el('strong','Проекты'));u.relationships.forEach(p=>projects.append(el('span',`${p.name} · ${p.relationship}`)));access.after(projects);}
  const footer=el('footer',undefined,'admin-user-footer');footer.append(form.querySelector('.focus-form-error'),form.querySelector('button[type=submit]'));form.append(footer);
}
function renderUsers(){const query=$('#adminUserSearch').value.toLowerCase(),role=$('#roleFilter').value,tbody=$('#usersTable');tbody.replaceChildren();users.filter(u=>(role==='all'||u.role_code===role)&&`${u.full_name} ${u.email} ${u.organization||''}`.toLowerCase().includes(query)).forEach(u=>{const tr=el('tr');[u.full_name+' · '+u.email,roleNames[u.role_code],u.organization||'—',accessNames[u.status],u.last_login_at?new Date(u.last_login_at).toLocaleString('ru-RU'):'Нет входов'].forEach(t=>tr.append(el('td',t)));const td=el('td');td.append(btn('Открыть',()=>userCard(u)));tr.append(td);tbody.append(tr);});}
async function approveRegistration(r){
  const result=await api('/api/admin/registration',{method:'POST',body:JSON.stringify({request_id:r.public_id,decision:'approve'})});
  await refresh();
  if(result.temporary_password){
    const d=dialog('Доступ создан',[],async()=>{},'Закрыть');
    const note=el('p',`Заявка ${r.email} была отправлена до обновления формы регистрации. Для первого входа передайте заявителю временный пароль:`);
    const password=el('code',result.temporary_password);password.className='legacy-password';
    const warning=el('p','Этот пароль показан один раз. Новые заявители задают пароль при регистрации.');
    d.querySelector('h2').after(note,password,warning);
  }else toast(`Доступ для ${r.full_name} открыт.`);
}
function renderRegistrations(){
  const host=$('#registrationList');host.replaceChildren();
  if(!registrations.length){host.append(el('p','Заявок пока нет.'));return;}
  registrations.forEach(r=>{
    const row=el('article');row.className='registration-card';
    const heading=el('div');heading.className='registration-card-main';
    const copy=el('div');copy.className='registration-card-copy';
    copy.append(el('h3',r.full_name),el('p',`${r.email} · ${r.organization}`));
    const state=el('span',accessNames[r.status]);state.className=`registration-state registration-state-${r.status}`;
    heading.append(copy,state);row.append(heading);
    if(r.status==='pending'){
      const actions=el('div');actions.className='request-actions';
      const approve=btn('Одобрить',async()=>{approve.disabled=true;try{await approveRegistration(r);}catch(error){toast(error.message);approve.disabled=false;}});
      approve.className='request-approve';
      const reject=btn('Отклонить',()=>dialog('Отклонить заявку?',[],(v,k)=>post('registration',{request_id:r.public_id,decision:'reject'},k),'Отклонить'));
      reject.className='request-reject';
      actions.append(approve,reject);row.append(actions);
    }
    host.append(row);
  });
}
function assignProject(project) {
  const staff = users.filter(user => user.role_code === 'fund_staff' && user.status === 'active');
  const current = users.find(user => user.public_id === project.manager_public_id);
  const options = [['', 'Не назначен'], ...staff.map(user => [user.public_id, `${user.full_name} · ${user.email}`])];
  const currentActive = staff.some(user => user.public_id === current?.public_id);
  const dialogNode = dialog('Ответственный сотрудник фонда', [
    {name:'manager_id', label:'Сотрудник', value:currentActive ? project.manager_public_id : '', options}
  ], async (values, key) => {
    await post('assign', {...values, project_id:project.public_id}, key);
    const selected = staff.find(user => user.public_id === values.manager_id);
    toast(selected ? `Сотрудник ${selected.full_name} назначен.` : 'Сотрудник снят с проекта.');
  });
  const description = el('p', `Проект: ${project.name}`);
  description.className = 'admin-assignment-project';
  dialogNode.querySelector('h2').after(description);
  if (current && !currentActive) {
    const warning = el('p', `Сейчас назначен ${current.full_name}, но его доступ неактивен. Выберите другого сотрудника.`);
    warning.className = 'admin-assignment-warning';
    dialogNode.querySelector('select').closest('label').after(warning);
  }
  if (!staff.length) {
    const warning = el('p', 'Нет активных сотрудников фонда. Создайте учётную запись сотрудника или откройте ему доступ.');
    warning.className = 'admin-assignment-warning';
    dialogNode.querySelector('select').closest('label').after(warning);
  }
}
function renderProjects(){
  const host=$('#adminProjects');host.replaceChildren();
  if(!projects.length){host.append(el('p','Проектов пока нет.'));return;}
  projects.forEach(project=>{
    const card=el('article');
    const manager=users.find(user=>user.public_id===project.manager_public_id);
    const assignment=el('p',manager?`Ответственный: ${manager.full_name}`:'Ответственный не назначен');
    assignment.className='admin-project-assignment';
    card.append(el('small',`${project.code} · УГТ ${project.ugt_level}`),el('h3',project.name),el('p',project.founder_name),el('p',({draft:'Подготовка',in_review:'На проверке',published:'Опубликован',rejected:'На доработке'})[project.review_state]),assignment,btn('Открыть проект',()=>location.href='./index.html#project/'+project.public_id),btn(manager?'Сменить сотрудника':'Назначить сотрудника',()=>assignProject(project)));
    host.append(card);
  });
}
const auditActions={'auth.login_success':'Вход в систему','auth.login_failed':'Неудачная попытка входа','auth.logout':'Выход из системы','auth.password_verified':'Пароль подтверждён','auth.otp_failed':'Неверный код SMS','project.created':'Проект создан','project.viewed':'Проект просмотрен','project.published':'Проект опубликован','tree.card':'Карточка изменена','tree.stages':'Этап добавлен','tree.stage-update':'Этап изменён','tree.stage-delete':'Этап удалён','tree.submit':'Отправлено на проверку','tree.rejected':'Вернули на доработку','team.member_added':'Участник добавлен','team.member_removed':'Участник удалён','question.created':'Вопрос задан','question.answered':'Ответ добавлен','demo.created':'Демопроект создан','project.assigned':'Сотрудник назначен','admin.assign':'Назначение сотрудника'};
const auditEntities={project:'Проект',user:'Пользователь',session:'Сессия',message:'Сообщение'};
function auditRow(a){const row=el('article');row.className='audit-entry';row.append(el('time',new Date(a.created_at).toLocaleString('ru-RU')),el('strong',auditActions[a.action]||a.action),el('p',`${a.actor_name||'Система'} · ${auditEntities[a.entity_type]||a.entity_type}`));const details=el('details');const summary=el('summary','Подробности');const body=el('dl');for(const [label,value] of [['Код действия',a.action],['Объект',a.entity_public_id||'—'],['IP-адрес',a.ip_address||'—'],['ID записи',a.public_id]]){body.append(el('dt',label),el('dd',value));}details.append(summary,body);let metadata={};try{metadata=JSON.parse(a.metadata_json||'{}');}catch{}if(Object.keys(metadata).length){const pre=el('pre',JSON.stringify(metadata,null,2));details.append(pre);}row.append(details);return row;}
function renderAuditPreview(){const host=$('#auditPreview');host.replaceChildren();if(!audit.length)host.append(el('p','Записей пока нет.'));audit.slice(0,4).forEach(a=>host.append(auditRow(a)));}
async function loadSystemActivity(){
  const host=$('#systemActivity'),status=$('#systemActivityStatus');status.textContent='Загружаем показатели…';host.replaceChildren();
  try{
    const data=await api('/api/admin/activity');
    const metrics=[['active_users','Активные пользователи','Уникальные участники с действиями'],['registrations','Регистрации','Новые учётные записи'],['actions','Действия в системе','Записи журнала аудита']];
    for(const [key,title,description] of metrics){
      const values=data.days.map(day=>day[key]),maximum=Math.max(1,...values),card=el('article',undefined,'admin-activity-card');
      const heading=el('div',undefined,'admin-activity-card-head');heading.append(el('span',title),el('strong',String(values.at(-1)??0)));
      card.append(heading,el('p',description));
      const chart=el('div',undefined,'admin-activity-chart');chart.setAttribute('role','img');chart.setAttribute('aria-label',data.days.map(day=>`${day.date}: ${day[key]}`).join(', '));
      data.days.forEach(day=>{
        const column=el('div',undefined,'admin-activity-day'),value=day[key];
        const track=el('div',undefined,'admin-activity-track'),bar=el('span',undefined,'admin-activity-bar'+(value?'':' is-empty'));
        bar.style.height=value?`${Math.max(8,value/maximum*100)}%`:'3px';track.append(bar);
        const label=new Date(`${day.date}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'});
        column.append(el('small',String(value)),track,el('time',label));chart.append(column);
      });
      card.append(chart);host.append(card);
    }
    status.textContent='';
  }catch(error){status.textContent=error.message;}
}
async function loadAudit(reset=false){const request=++auditRequest;if(reset){auditCursor=null;auditShown=0;$('#auditLog').replaceChildren();}const params=new URLSearchParams(new FormData($('#auditFilters')));for(const [key,value] of [...params])if(!value)params.delete(key);if(auditCursor)params.set('before',auditCursor);$('#auditStatus').textContent='Загружаем события…';$('#auditMore').disabled=true;try{const data=await api('/api/admin/audit?'+params.toString());if(request!==auditRequest)return;data.items.forEach(a=>$('#auditLog').append(auditRow(a)));auditShown+=data.items.length;auditCursor=data.next_cursor;$('#auditMore').hidden=!auditCursor;$('#auditStatus').textContent=auditShown?`Показано записей: ${auditShown}`:'По этим условиям событий нет.';}catch(error){if(request===auditRequest)$('#auditStatus').textContent=error.message;throw error;}finally{if(request===auditRequest)$('#auditMore').disabled=false;}}
async function loadLogs(){
  const host=$('#logsList'),status=$('#logsStatus');
  status.textContent='Загружаем логи…';host.replaceChildren();
  try {
    const level=$('#logsLevel').value;
    const data=await api('/api/admin/logs'+(level?'?level='+encodeURIComponent(level):''));
    if(!data.items.length){status.textContent='Записей пока нет.';return;}
    status.textContent=`Показано записей: ${data.items.length}. Хранятся до перезапуска приложения.`;
    data.items.forEach(item=>{
      const row=el('article',undefined,`admin-log admin-log-${item.level}`);
      const head=el('div',undefined,'admin-log-head');
      head.append(el('time',new Date(item.created_at).toLocaleString('ru-RU')),el('strong',item.level==='error'?'Ошибка сервера':item.level==='warning'?'Ошибка запроса':'Информация'),el('code',`${item.method} ${item.status}`));
      row.append(head,el('p',item.message),el('small',item.path));host.append(row);
    });
  }catch(error){status.textContent=error.message;}
}
async function refresh(){const [overview,u,r,p,a]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users'),api('/api/admin/registrations'),api('/api/projects'),api('/api/admin/audit')]);users=u.items;registrations=r.items;projects=p.items;audit=a.items;const metrics=$('#adminMetrics');metrics.replaceChildren();[['Пользователи',overview.users],['Инвесторы',overview.investors],['Проекты',overview.projects],['На проверке',overview.reviews],['Новые заявки',overview.pending_registrations],['Аудит за сутки',overview.audit_today]].forEach(([title,value])=>{const card=el('article');card.append(el('span',title),el('strong',value));metrics.append(card);});$('#usersBadge').textContent=overview.users;$('#requestsBadge').textContent=overview.pending_registrations;$('#projectsBadge').textContent=overview.projects;$('#auditBadge').textContent=overview.audit_today;$('#taskRequests').textContent=overview.pending_registrations;$('#taskReviews').textContent=overview.reviews;renderUsers();renderRegistrations();renderProjects();renderAuditPreview();}
function openProject(id){location.href='./index.html#project/'+encodeURIComponent(id);}
$('#adminNotifications').onclick=()=>run(WorkflowUI.notifications);
async function init(){if(!localStorage.getItem('bokToken'))return location.replace('./index.html#auth');try{const {user}=await api('/api/auth/me');if(user.role!=='super_admin')return location.replace('./index.html#dashboard');$('#adminName').textContent=user.full_name;await refresh();const h=await api('/api/health');$('#apiStatus').textContent=h.status==='ok'?'Работает':'Ошибка';$('#dbStatus').textContent=h.database==='ok'?'Работает':'Ошибка';$('#currentTime').textContent=new Date().toLocaleTimeString('ru-RU');$('#loading').hidden=true;$('#adminApp').hidden=false;}catch(e){$('#loading').textContent=e.message;const retry=btn('Повторить',init);$('#loading').append(retry);}}
document.addEventListener('click',e=>{const section=e.target.closest('[data-section]');if(section)showSection(section.dataset.section);if(e.target.closest('[data-new-user]'))createUser();});$('#logsLevel').onchange=loadLogs;$('#logsRefresh').onclick=loadLogs;$('#auditFilters').onsubmit=e=>{e.preventDefault();loadAudit(true).catch(error=>toast(error.message));};$('#auditFilters').onreset=()=>queueMicrotask(()=>loadAudit(true).catch(error=>toast(error.message)));$('#auditMore').onclick=()=>loadAudit().catch(error=>toast(error.message));$('#adminUserSearch').oninput=renderUsers;$('#roleFilter').onchange=renderUsers;$('#adminLogout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});}finally{localStorage.removeItem('bokToken');location.replace('./index.html#auth');}};init();
