(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const text = (tag, value, className='') => { const node=document.createElement(tag); node.textContent=value; if(className)node.className=className; return node; };
  const host=$('#previewProjects');
  let projects=[];
  function showTab(name){
    $$('.preview-view').forEach(view=>view.classList.toggle('is-active',view.dataset.previewView===name));
    $$('[data-preview-tab]').forEach(button=>button.classList.toggle('is-active',button.dataset.previewTab===name));
    location.hash=name;
  }
  $$('[data-preview-tab]').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.previewTab)));
  function showProject(project){
    const detail=$('#previewDetail'); detail.replaceChildren(); detail.hidden=false;
    const header=text('div','', 'preview-detail-head');
    const title=text('h2',project.name); const meta=text('span',`${project.code} · УГТ ${project.ugt_level}`);
    header.replaceChildren(title,meta); detail.append(header,text('p',project.summary||'Описание проекта пока не добавлено.'));
    const tree=text('div','','preview-stage-list');
    if(project.stages.length){project.stages.forEach((stage,index)=>{
      const item=text('div','','preview-stage');
      item.append(text('small',`D${stage.position||index+1}`),text('strong',stage.title),text('span',({completed:'Завершён',in_progress:'В работе',planned:'В плане'})[stage.status]||'Этап'));
      tree.append(item);
    });}else tree.append(text('p','Опубликованных этапов пока нет.','preview-empty'));
    detail.append(tree);
    const footer=text('div','','preview-detail-footer');const link=text('a','Войти для подробного просмотра ↗');link.href='./index.html#auth';footer.append(link);detail.append(footer);
    detail.scrollIntoView({block:'nearest'});
  }
  function renderProjects(){
    host.replaceChildren();
    if(!projects.length){host.append(text('p','Опубликованных проектов пока нет. Загляните позже или войдите, чтобы разместить свой проект.','preview-empty'));return;}
    projects.forEach(project=>{
      const card=text('article','','preview-project-card');
      const meta=text('div','','preview-card-meta');meta.append(text('span',project.code),text('span',`УГТ ${project.ugt_level}`));
      const open=text('button','Посмотреть этапы →','preview-card-open');open.type='button';open.addEventListener('click',()=>showProject(project));
      card.append(meta,text('h2',project.name),text('p',project.summary||'Описание пока не добавлено.'),open);host.append(card);
    });
  }
  fetch('/api/public/projects').then(response=>{if(!response.ok)throw new Error();return response.json();}).then(data=>{projects=Array.isArray(data.items)?data.items:[];renderProjects();}).catch(()=>{host.replaceChildren(text('p','Не удалось загрузить проекты. Обновите страницу и попробуйте снова.','preview-empty'));});
  const tab=location.hash.slice(1);if(['projects','chat','profile'].includes(tab))showTab(tab);
})();
