/* Request keys only provide retry idempotency; they are not authentication secrets. */
let requestKeySequence = 0;
function newRequestKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    const seed = Date.now() + (++requestKeySequence);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256) ^ ((seed >>> ((i % 4) * 8)) & 255);
  }
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* Shared task-oriented forms; errors preserve all entered values. */
const WorkflowUI = (() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const btn=(text,fn)=>{const n=el('button',text,'focus-secondary');n.type='button';n.onclick=fn;return n;};
  const states={draft:'Подготовка',in_review:'На проверке',published:'Опубликовано',rejected:'На доработке'};
  const actions={'project.created':'Проект создан','demo.created':'Демонстрационный проект создан','demo.simplified':'Демонстрационное дерево сокращено','tree.draft_created':'Создана рабочая версия','tree.card':'Обновлена карточка','tree.stages':'Добавлен этап','tree.stage-update':'Изменён этап','tree.stage-delete':'Удалён этап','tree.submit':'Отправлено на проверку','project.published':'Опубликовано','tree.rejected':'Возвращено на доработку','tree.material':'Добавлен материал','tree.material-delete':'Удалён материал','project.assigned':'Назначен сотрудник фонда','team.member_added':'Добавлен участник','tree.stage-position':'Перемещён узел дерева','tree.stage-outcome':'Подведён итог события','team.member_removed':'Удалён участник','question.created':'Задан вопрос','question.answered':'Добавлен ответ'};
  const stamp=x=>x?new Date(x).toLocaleString('ru-RU'):'—';
  function dialog(title,fields,save,label='Сохранить',draftId=null) {
    const d=el('dialog',undefined,'focus-dialog workflow-dialog'),form=el('form');form.append(el('h2',title));
    fields.forEach(f=>{const lab=el('label',f.label);let input;
      if(f.options){input=el('select');f.options.forEach(([value,text])=>input.append(new Option(text,value)));}
      else {input=el(f.type==='textarea'?'textarea':'input');if(f.type!=='textarea')input.type=f.type||'text';else input.rows=4;}
      input.name=f.name;input.required=!!f.required;if(f.max)input.maxLength=f.max;if(f.minLength)input.minLength=f.minLength;if(f.placeholder)input.placeholder=f.placeholder;if(f.autocomplete)input.autocomplete=f.autocomplete;if(f.pattern)input.pattern=f.pattern;if(f.min!==undefined)input.min=f.min;if(f.maxValue!==undefined)input.max=f.maxValue;if(f.value!==undefined)input.value=f.value??'';
      lab.append(input);form.append(lab);
    });
    const error=el('p',undefined,'focus-form-error');error.setAttribute('role','alert');const submit=el('button',label,'focus-primary');submit.type='submit';
    form.append(error,submit);d.append(btn('Закрыть',()=>d.close()),form);document.body.append(d);d.onclose=()=>d.remove();d.showModal();
    const draftKey=draftId&&document.body.dataset.userId?`bokWorkflowDraft:${document.body.dataset.userId}:${draftId}`:null;
    let requestKey=newRequestKey();
    if(draftKey)try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(saved){for(const [name,value] of Object.entries(saved.values||{}))if(form.elements[name]&&form.elements[name].type!=='file')form.elements[name].value=value;requestKey=saved.requestKey||requestKey;}}catch{}
    const persist=()=>{if(draftKey)try{sessionStorage.setItem(draftKey,JSON.stringify({values:Object.fromEntries(new FormData(form)),requestKey}));}catch{}};
    form.addEventListener('input',()=>{requestKey=newRequestKey();persist();});
    form.addEventListener('change',()=>{requestKey=newRequestKey();persist();});
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;error.textContent='';persist();try{await save(Object.fromEntries(new FormData(form)),requestKey);if(draftKey)sessionStorage.removeItem(draftKey);d.close();}catch(e){error.textContent=e.message;}finally{submit.disabled=false;}};
    return d;
  }
  const command=async(data,action,values={},key=newRequestKey())=>{await api(`/api/projects/${data.project.public_id}/${action}`,{method:'POST',body:JSON.stringify({...values,revision:data.tree_version?.revision,request_key:key})});await refreshProjectView(data.project.public_id);};
  function uploadMaterial(projectId,stageId,file,onProgress=()=>{},signal){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      const failed=message=>reject(new Error(message||`Не удалось загрузить «${file.name}».`));
      xhr.open('POST',`/api/projects/${encodeURIComponent(projectId)}/materials/upload`);
      xhr.setRequestHeader('Authorization',`Bearer ${localStorage.getItem('bokToken')}`);
      xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
      xhr.setRequestHeader('X-Stage-Id',stageId);
      xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));
      xhr.upload.onprogress=event=>onProgress(event.lengthComputable?Math.min(99,Math.round(event.loaded/event.total*100)):null);
      xhr.onload=()=>{
        let result={};try{result=JSON.parse(xhr.responseText||'{}');}catch{}
        if(xhr.status<200||xhr.status>=300)return failed(result.message);
        onProgress(100);resolve(result);
      };
      xhr.onerror=()=>failed(`Не удалось загрузить «${file.name}». Проверьте соединение и повторите.`);
      xhr.onabort=()=>failed('Загрузка отменена.');
      if(signal){if(signal.aborted)return failed('Загрузка отменена.');signal.addEventListener('abort',()=>xhr.abort(),{once:true});}
      xhr.send(file);
    });
  }
  function controls(host,data) {
    const bar=el('div',undefined,'workflow-bar');bar.append(el('span',`${states[data.tree_version?.state]||'Нет версии'} · Версия ${data.tree_version?.version_number||1}`));
    if(data.tree_version?.review_comment)bar.append(el('p',data.tree_version.review_comment));
    if(data.can_edit){bar.append(btn('Карточка проекта',()=>editCard(data)),btn('На проверку',()=>dialog('Отправить на проверку',[{name:'summary',label:'Что изменилось',type:'textarea',required:true,max:2000}],(v,k)=>command(data,'submit',v,k),'Отправить',`submit:${data.project.public_id}`)));}
    if(data.can_manage&&['published','rejected'].includes(data.tree_version?.state))bar.append(btn('Редактировать новую версию',()=>run(()=>command(data,'draft'))));
    if(data.can_review&&data.tree_version?.state==='in_review'){
      bar.append(btn('Опубликовать',()=>dialog('Подтверждение публикации',[{name:'comment',label:'Комментарий к публикации',type:'textarea',max:2000}],(v,k)=>command(data,'publish',v,k),'Опубликовать')));
      bar.append(btn('Вернуть на доработку',()=>dialog('Что нужно исправить',[{name:'comment',label:'Комментарий основателю',type:'textarea',required:true,max:2000}],(v,k)=>command(data,'reject',v,k),'Вернуть')));
    }
    bar.append(btn('Уведомления',()=>{location.hash='notifications';}));
    bar.append(btn(data.subscribed?'Не следить':'Следить за обновлениями',()=>run(()=>command(data,'subscribe',{enabled:!data.subscribed}))));
    host.append(bar);
  }
  function run(fn){Promise.resolve().then(fn).catch(e=>{const d=dialog('Не удалось выполнить действие',[],async()=>{},'Понятно');d.querySelector('h2').after(el('p',e.message));});}
  function editCard(data){const p=data.project;dialog('Карточка проекта',[
    ...[['name','Название'],['summary','Краткое описание'],['description','Подробное описание'],['field','Область науки'],['region','Регион']].map(([name,label])=>({name,label,value:p[name],required:name!=='region',type:['description','summary'].includes(name)?'textarea':'text',max:10000})),
    {name:'ugt_level',label:'УГТ',value:p.ugt_level,type:'number',min:1,maxValue:9,required:true},
    {name:'status',label:'Статус после публикации',value:p.status==='draft'?'active':p.status,options:[['active','Активный'],['paused','Приостановлен'],['completed','Завершён']]}
  ],(v,k)=>command(data,'card',v,k),'Сохранить',`card:${data.project.public_id}`);}
  function stage(data,s){dialog(s?'Изменить событие':'Добавить событие',[
    {name:'title',label:'Название',value:s?.title,required:true,max:100},
    {name:'description',label:'Цель и результат',value:s?.description,type:'textarea',max:10000},
    {name:'criteria_text',label:'Критерии готовности — по одному в строке; выполненные начинайте с [x]',value:s?.criteria_text,type:'textarea',max:4000},
    {name:'attention_note',label:'Что требует внимания',value:s?.attention_note,type:'textarea',max:1000},
    {name:'status',label:'Статус',value:s?.status||'planned',options:[['planned','В плане'],['in_progress','В работе'],['completed','Завершён']]},
    {name:'progress',label:'Готовность, % (завершённый этап — 100%)',value:s?.progress||0,type:'number',min:0,maxValue:100,required:true},
    {name:'ugt_level',label:'УГТ',value:s?.ugt_level||data.project.ugt_level,type:'number',min:1,maxValue:9,required:true},
    {name:'due_at',label:'Контрольная дата',type:'date',value:s?.due_at},
    {name:'parent',label:'После события',value:s?.parent_public_id||'',options:[['','Начало проекта'],...data.stages.filter(x=>x.public_id!==s?.public_id).map(x=>[x.public_id,x.title])]},
    {name:'owner',label:'Ответственный',value:s?.owner_public_id||'',options:[['','Не назначен'],...(data.team||[]).map(x=>[x.public_id,x.full_name])]}
  ],(v,k)=>command(data,s?'stage-update':'stages',{...v,stage_id:s?.public_id},k),'Сохранить',`stage:${data.project.public_id}:${s?.public_id||'new'}`);}
  function stageActions(host,data,s){if(!data.can_edit)return;const row=el('div',undefined,'workflow-buttons');row.append(btn('Изменить',()=>stage(data,s)),btn('Удалить',()=>dialog('Удалить этап? Дочерние этапы сохранятся.',[],(v,k)=>command(data,'stage-delete',{stage_id:s.public_id},k),'Удалить')));host.append(row);}
  async function download(data,m){const response=await fetch(`/api/projects/${data.project.public_id}/materials/${m.public_id}/download`,{headers:{Authorization:`Bearer ${localStorage.getItem('bokToken')}`}});if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.message||'Не удалось скачать файл.');}const url=URL.createObjectURL(await response.blob());const a=el('a');a.href=url;a.download=m.title;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function materials(host,data){
    if(data.can_edit)host.append(btn('Добавить файл',()=>{
      const controller=new AbortController();
      const d=dialog('Материал к этапу (до 50 МБ)',[{name:'stage_id',label:'Этап',options:data.stages.map(s=>[s.public_id,s.title]),required:true},{name:'file',label:'Файл',type:'file',required:true}],async(v)=>{
        if(!v.file?.size)throw new Error('Выберите файл для загрузки.');
        if(v.file.size>50_000_000)throw new Error('Максимальный размер файла — 50 МБ.');
        progressBox.hidden=false;progress.value=0;progressText.textContent='Подготовка файла…';
        await uploadMaterial(data.project.public_id,v.stage_id,v.file,value=>{
          progress.removeAttribute('value');
          if(value!==null){progress.value=value;progressText.textContent=value===100?'Файл загружен. Обновляем список…':`Загружено ${value}%`;}
          else progressText.textContent='Загружаем файл…';
        },controller.signal);
        const updated=await api(`/api/projects/${encodeURIComponent(data.project.public_id)}`);
        host.replaceChildren();materials(host,updated);
        host.prepend(el('p',`Файл «${v.file.name}» добавлен.`, 'workflow-upload-success'));
      },'Загрузить');
      const progressBox=el('div',undefined,'workflow-upload-progress');progressBox.hidden=true;
      const progressText=el('span','Подготовка файла…');progressText.setAttribute('role','status');
      const progress=el('progress');progress.max=100;progress.value=0;
      progressBox.append(progressText,progress);
      d.querySelector('.focus-form-error').before(progressBox);
      d.addEventListener('close',()=>controller.abort(),{once:true});
    }));
    if(!data.materials.length)host.append(el('p','Материалов пока нет.'));
    data.materials.forEach(m=>{const row=el('div',undefined,'workflow-row');row.append(el('span',`${m.title} · ${Math.ceil(m.byte_size/1024)} КБ`),btn('Скачать',()=>run(()=>download(data,m))));if(data.can_edit)row.append(btn('Удалить',()=>dialog('Удалить материал?',[],(v,k)=>command(data,'material-delete',{material_id:m.public_id},k),'Удалить')));host.append(row);});
  }
  function team(host,data){
    const labels={owner:'Основатель',manager:'Сотрудник фонда',researcher:'Исследователь · редактирование',viewer:'Участник · просмотр'};
    if(data.can_manage_team)host.append(btn('Добавить участника',()=>run(async()=>{
      const {items}=await api(`/api/projects/${data.project.public_id}/team-candidates`);
      if(!items.length){const d=dialog('Нет доступных участников',[],async()=>{},'Понятно');d.querySelector('h2').after(el('p','Администратор может создать учётную запись основателя.'));return;}
      dialog('Добавить участника',[{name:'user_id',label:'Участник',options:[['','Выберите участника'],...items.map(x=>[x.public_id,x.full_name+(x.organization?' · '+x.organization:'')])],required:true},{name:'member_role',label:'Доступ',options:[['researcher','Редактирование'],['viewer','Просмотр']]}],(v,k)=>command(data,'team',{...v,enabled:true},k),'Добавить');
    })));
    if(!data.team.length)host.append(el('p','Участники пока не добавлены.'));
    data.team.forEach(member=>{
      const row=el('div',undefined,'workflow-row');
      row.append(el('strong',member.full_name),el('span',`${labels[member.member_role]||member.role_name}${member.organization?' · '+member.organization:''}`));
      if(data.can_manage_team&&['researcher','viewer'].includes(member.member_role)){
        row.append(btn('Доступ',()=>dialog('Доступ участника',[{name:'member_role',label:'Права',value:member.member_role,options:[['researcher','Редактирование'],['viewer','Просмотр']]}],(v,k)=>command(data,'team',{...v,user_id:member.public_id,enabled:true},k))));
        row.append(btn('Удалить',()=>dialog('Удалить участника?',[],(v,k)=>command(data,'team',{user_id:member.public_id,member_role:member.member_role,enabled:false},k),'Удалить')));
      }
      host.append(row);
    });
  }
  function history(host,data){if(!data.history.length)host.append(el('p','История пока пуста.'));data.history.forEach(h=>{const row=el('article',undefined,'workflow-row');row.append(el('strong',actions[h.action]||h.action),el('span',`${h.author||'Система'} · ${stamp(h.created_at)}`));let meta={};try{meta=JSON.parse(h.metadata_json);}catch{}if(meta.comment||meta.summary)row.append(el('p',meta.comment||meta.summary));
    if(meta.changes){const captions={name:'Название',summary:'Краткое описание',description:'Описание',field:'Область',region:'Регион',ugt_level:'УГТ',status:'Статус',progress:'Готовность',due_at:'Дата'};const value=x=>({planned:'В плане',in_progress:'В работе',completed:'Завершён',active:'Активный',paused:'Приостановлен',draft:'Подготовка'})[x]||String(x??'—');
    for(const [key,change] of Object.entries(meta.changes)){if(key==='stage'){const a=change.before||{},b=change.after||{};row.append(el('p',b.title||a.title||'Этап'));for(const k of new Set([...Object.keys(a),...Object.keys(b)])){if(a[k]!==b[k])row.append(el('p',`${captions[k]||k}: ${value(a[k])} → ${value(b[k])}`));}}else row.append(el('p',`${captions[key]||key}: ${value(change.before)} → ${value(change.after)}`));}}host.append(row);});}
  function questions(host,data){if(data.can_ask)host.append(btn('Задать вопрос',()=>dialog('Вопрос сотруднику фонда',[{name:'body',label:'Ваш вопрос',type:'textarea',max:5000,required:true}],(v,k)=>command(data,'questions',v,k),'Отправить',`question:${data.project.public_id}`)));if(!data.questions.length)host.append(el('p','Вопросов пока нет.'));data.questions.forEach(q=>{const row=el('article',undefined,'workflow-question');row.append(el('small',`${q.author} · ${stamp(q.created_at)}`),el('p',q.body));q.replies.forEach(r=>{const reply=el('blockquote');reply.append(el('small',`${r.author} · ${stamp(r.created_at)}`),el('p',r.body));row.append(reply);});if(data.can_review)row.append(btn('Ответить',()=>dialog('Ответ инвестору',[{name:'body',label:'Ответ',type:'textarea',max:5000,required:true}],(v,k)=>command(data,'reply',{...v,question_id:q.public_id},k),'Отправить',`reply:${data.project.public_id}:${q.public_id}`)));host.append(row);});}
  async function notifications(){const data=await api('/api/notifications');const d=dialog('Уведомления',[],async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})});},'Отметить прочитанными');const list=el('div');if(!data.items.length)list.append(el('p','Новых уведомлений пока нет.'));data.items.forEach(n=>{const row=el('article',undefined,'workflow-row');row.append(el('strong',`${n.read_at?'':'● '}${n.title}`),el('p',n.body),el('small',stamp(n.created_at)),btn('Открыть проект',async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({notification_id:n.public_id})});d.close();await openProject(n.entity_public_id);}));list.append(row);});d.querySelector('form').prepend(list);}
  function compare(){ location.hash = 'compare'; }
  return {controls,stage,stageActions,materials,team,history,questions,notifications,compare,dialog,run,download,uploadMaterial,el,btn,actionTitle:action=>actions[action]||action};
})();
