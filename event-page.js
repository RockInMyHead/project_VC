const EventPage=(()=>{
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const button=(text,cls,fn)=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const outcomes={success:'Успешно',failure:'Неуспешно',inconclusive:'Неопределённо'};
  const statuses={planned:'В плане',in_progress:'В работе',completed:'Завершено'};
  const date=value=>value?new Date(value).toLocaleDateString('ru-RU'):'Не назначена';
  function render(host,data,id){
    const stage=data.stages.find(s=>s.public_id===id),project=data.project;
    document.body.classList.add('matrix28-page','project-focus');host.className='matrix28 event-page';host.replaceChildren();
    host.append(button('← К дереву проекта','event-back',()=>{location.hash=`project/${project.public_id}`;}));
    if(!stage){host.append(el('h1','','Событие не найдено'),el('p','','Возможно, оно удалено или отсутствует в доступной версии проекта.'));return;}
    const head=el('header','event-heading'),heading=el('div');
    heading.append(el('span','event-kicker',`${project.name} / Событие D${stage.position}`),el('h1','',stage.title),el('span','event-status',statuses[stage.status]));head.append(heading);
    if(data.can_edit)head.append(button('Редактировать событие','event-secondary',()=>WorkflowUI.stage(data,stage)));
    host.append(head);
    const meta=el('dl','event-meta');
    [['Ответственный',stage.owner_name||'Не назначен'],['Контрольная дата',date(stage.due_at)],['Готовность этапа',`${stage.progress||0}%`],['Уровень готовности',`УГТ ${stage.ugt_level||project.ugt_level}`]].forEach(([name,value])=>{const item=el('div');item.append(el('dt','',name),el('dd','',value));meta.append(item);});host.append(meta);
    const columns=el('div','event-columns'),content=el('div','event-content'),side=el('section','event-result');
    const section=(title,text)=>{const box=el('section','event-section');box.append(el('h2','',title),el('p','event-long-text',text));content.append(box);return box;};
    section('Описание события',stage.description||'Основатель пока не добавил описание события.');
    const criteria=section('Критерии готовности','');criteria.lastChild.remove();
    const items=(stage.criteria_text||'').split('\n').map(x=>x.trim()).filter(Boolean);
    if(!items.length)criteria.append(el('p','event-empty','Критерии пока не указаны.'));
    items.forEach(text=>{const row=el('div','event-criterion');row.append(el('span','',/^\[x\]/i.test(text)?'✓':'○'),el('span','',text.replace(/^\[[x ]\]\s*/i,'')));criteria.append(row);});
    if(stage.choices?.length){const choices=section('Варианты результата','');choices.lastChild.remove();stage.choices.forEach((text,index)=>{const row=el('label','event-choice'),radio=el('input');radio.type='radio';radio.disabled=true;radio.checked=stage.selected_choice===index;row.append(radio,el('span','',text));choices.append(row);});}
    if(stage.attention_note)section('Требует внимания',stage.attention_note);
    const materials=section('Материалы события','');materials.lastChild.remove();
    WorkflowUI.materials(materials,{...data,materials:data.materials.filter(m=>m.stage_public_id===id),stages:[stage]});
    side.append(el('span','event-kicker','РЕЗУЛЬТАТ СОБЫТИЯ'),el('h2','',stage.outcome?outcomes[stage.outcome]:'Итог ещё не подведён'));
    if(stage.outcome){side.classList.add(stage.outcome);side.append(el('p','event-long-text',stage.outcome_note),el('small','event-outcome-date',`Итог сохранён ${date(stage.outcome_at)}`));}
    else side.append(el('p','event-empty','Основатель подведёт итог после завершения исследования.'));
    if(data.can_conclude){
      const form=el('form','event-outcome-form'),legend=el('fieldset');legend.append(el('legend','',stage.outcome?'Уточнить итог':'Подвести итог'));
      Object.entries(outcomes).forEach(([value,text])=>{const row=el('label','event-outcome-option'),radio=el('input');radio.type='radio';radio.name='outcome';radio.value=value;radio.required=true;radio.checked=stage.outcome===value;row.append(radio,el('span','',text));legend.append(row);});
      const noteLabel=el('label','event-note-label','Вывод и обоснование'),note=el('textarea');note.name='outcome_note';note.rows=5;note.required=true;note.minLength=2;note.maxLength=10000;note.value=stage.outcome_note||'';note.placeholder='Что получилось, какие данные подтверждают итог и что делать дальше?';noteLabel.append(note);
      const message=el('p','event-form-message');message.setAttribute('role','status');
      const save=el('button','event-save','Сохранить итог');save.type='submit';form.append(legend,noteLabel,el('p','event-form-hint','После сохранения событие будет отмечено завершённым. Итог можно уточнить в рабочей версии.'),message,save);
      const requestKey=newRequestKey();
      form.onsubmit=async event=>{event.preventDefault();save.disabled=true;message.textContent='';try{
        await api(`/api/projects/${project.public_id}/stage-outcome`,{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(form)),stage_id:id,revision:data.tree_version.revision,request_key:requestKey})});
        await openEventPage(project.public_id,id);
      }catch(error){message.textContent=error.message;save.disabled=false;}};
      side.append(form);
    }
    columns.append(content,side);host.append(columns);
  }
  return {render};
})();
