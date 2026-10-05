/* Figma Page 1, frame 28: responsive decision tree connected to live project data. */
const Matrix28 = (() => {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  const svg=(tag,attributes)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attributes).forEach(([key,value])=>n.setAttribute(key,value));return n;};
  const dt=value=>{const d=value?new Date(value):null;return d&&!Number.isNaN(d.getTime())?d:null;};
  const label=d=>d?d.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}):'Срок не указан';
  const shortDate=d=>d?d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'Не назначена';
  const state={completed:'завершено',in_progress:'в работе',planned:'в плане'};
  // All lens gestures use the same interval, in milliseconds.
  function moveLens(start,end,delta,kind,min,max,minWidth,maxWidth){
    const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
    if(kind==='left')start=clamp(start+delta,Math.max(min,end-maxWidth),end-minWidth);
    else if(kind==='right')end=clamp(end+delta,start+minWidth,Math.min(max,start+maxWidth));
    else {delta=clamp(delta,min-start,max-end);start+=delta;end+=delta;}
    return {start,end};
  }
  function layout(stages){
    const byId=new Map(stages.map(s=>[s.public_id,s])),children=new Map(stages.map(s=>[s.public_id,[]])),roots=[];
    stages.forEach(s=>{if(s.parent_public_id!==s.public_id&&byId.has(s.parent_public_id))children.get(s.parent_public_id).push(s);else roots.push(s);});
    const points=new Map(),visited=new Set();let leaves=0,maxDepth=0;
    const place=(s,depth)=>{
      if(visited.has(s.public_id))return null;
      visited.add(s.public_id);maxDepth=Math.max(maxDepth,depth);
      const rows=children.get(s.public_id).map(child=>place(child,depth+1)).filter(y=>y!==null);
      const y=rows.length?(rows[0]+rows.at(-1))/2:100+leaves++*200;
      points.set(s.public_id,{x:200+depth*280,y});return y;
    };
    roots.forEach(s=>place(s,0));stages.forEach(s=>{if(!visited.has(s.public_id))place(s,0);});
    const contentHeight=200+Math.max(0,leaves-1)*200;let height=Math.max(500,contentHeight),width=Math.max(700,200+maxDepth*280+265);
    points.forEach(p=>p.y+=(height-contentHeight)/2);
    stages.forEach(s=>{if(Number.isFinite(s.map_x)&&Number.isFinite(s.map_y)){const p=points.get(s.public_id);p.x=s.map_x;p.y=s.map_y;width=Math.max(width,p.x+265);height=Math.max(height,p.y+210);}});
    return {points,width,height};
  }
  function render(host,data){
    const {project,stages=[]}=data;
    document.body.classList.add('project-focus','matrix28-page');
    const compactDemo=project.code==='DEMO-KUMA30';
    host._lensResize?.disconnect();
    host._lensDragCleanup?.();
    host.className='matrix28'+(compactDemo?' mx-demo-compact':'');host.replaceChildren();
    let selected=stages.find(s=>s.status==='in_progress')||stages[0]||null;
    let center=dt(selected?.due_at)||new Date(),months=3,query='',filter='all',calendarSpanDays=730,lensBounds=null;
    const monthMs=30.4375*86400000;
    const top=el('div','mx-top');
    top.append(btn('БОК О БОК','mx-brand',showProjectList),btn('ПРОЕКТЫ','mx-breadcrumb',showProjectList),el('span','mx-breadcrumb','/'),el('span','mx-breadcrumb',project.code),el('span','mx-spacer'),el('span','mx-top-state',(data.tree_version?.state==='published'?'ОПУБЛИКОВАНО':'РАБОЧАЯ ВЕРСИЯ')+' · ТЕКУЩАЯ ВЕХА: '+label(center).toUpperCase()));
    const hero=el('header','mx-hero'),title=el('div','mx-title'),heroActions=el('div','mx-actions');
    title.append(el('h1','',project.name||project.code),el('p','',project.code+' · '+(project.field||'Научный проект')));
    const facts=el('div','mx-project-facts');
    facts.append(el('span','',`УГТ ${project.ugt_level||1}`),el('span','',`${stages.filter(s=>s.status==='completed').length} завершено`),el('span','',`${stages.filter(s=>s.status==='in_progress').length} в работе`),el('span','',`${stages.filter(s=>s.status==='planned').length} в плане`));
    title.append(facts);
    const search=btn('⌕  Поиск','mx-tool',()=>{searchField.hidden=!searchField.hidden;if(!searchField.hidden)searchInput.focus();});
    const availableStatuses=[['completed','Завершено'],['in_progress','В работе'],['planned','В плане']].filter(([status])=>stages.some(stage=>stage.status===status));
    const filters=btn('▤  Фильтры','mx-tool',()=>{filterField.hidden=!filterField.hidden;filters.setAttribute('aria-expanded',String(!filterField.hidden));});
    filters.hidden=availableStatuses.length<2;
    filters.setAttribute('aria-expanded','false');
    heroActions.append(search,filters);
    if(data.can_edit)heroActions.append(btn('+ Событие','mx-tool mx-add',()=>WorkflowUI.stage(data)));
    hero.append(title,heroActions);
    const sectionTabs=el('nav','mx-section-tabs');sectionTabs.setAttribute('aria-label','Разделы проекта');
    const utility=el('div','mx-utility'),searchField=el('label','mx-search'),searchInput=el('input','');
    searchField.hidden=true;searchInput.type='search';searchInput.placeholder='Поиск по названию и описанию';searchInput.oninput=()=>{query=searchInput.value.trim().toLowerCase();drawGraph();};searchField.append(searchInput);
    const filterField=el('div','mx-filter');filterField.hidden=true;
    [['all','Все'],...availableStatuses].forEach(([value,text])=>{const option=btn(text,value==='all'?'active':'',()=>{filter=value;[...filterField.children].forEach(button=>button.classList.toggle('active',button.dataset.status===value));if(filter!=='all'&&selected?.status!==filter)selected=stages.find(stage=>stage.status===filter)||null;drawGraph();drawInspector();});option.dataset.status=value;filterField.append(option);});
    utility.append(searchField,filterField);
    const primary=el('div','mx-primary'),graph=el('section','mx-graph'),inspector=el('aside','mx-inspector');
    const graphHeader=el('div','mx-graph-header');
    const eventWord=stages.length%100>=11&&stages.length%100<=14?'событий':stages.length%10===1?'событие':stages.length%10>=2&&stages.length%10<=4?'события':'событий';
    const positionText=el('span','mx-position','');
    const navigate=step=>{const visible=filter==='all'?stages:stages.filter(stage=>stage.status===filter);if(!visible.length)return;const index=Math.max(0,visible.findIndex(stage=>stage.public_id===selected?.public_id));selected=visible[(index+step+visible.length)%visible.length];center=stageDate(selected)||center;draw();scrollToSelected();};
    const nodeNavigation=el('div','mx-node-navigation');
    nodeNavigation.append(btn('←','',()=>navigate(-1)),positionText,btn('→','',()=>navigate(1)));
    nodeNavigation.firstChild.setAttribute('aria-label','Предыдущее событие');
    nodeNavigation.lastChild.setAttribute('aria-label','Следующее событие');
    graphHeader.append(el('h2','','Карта проекта'),el('span','mx-count',stages.length+' '+eventWord),nodeNavigation,btn('Сегодня','mx-graph-focus',()=>{center=new Date();draw();}));
    const eras=el('div','mx-eras');
    const dated=stages.map(s=>dt(s.due_at)||dt(s.completed_at)).filter(Boolean).sort((a,b)=>a-b);
    [['ПРОШЛОЕ',dated.length?dated[0].getFullYear()+' — '+(new Date().getFullYear()):'Завершённые этапы'],['ТЕКУЩИЕ ИССЛЕДОВАНИЯ',label(center)],['БУДУЩЕЕ',dated.length?label(dated.at(-1)):'План развития']].forEach(([a,b],i)=>{const x=el('div',i===1?'active':'');x.append(el('b','',a),el('span','',b));eras.append(x);});
    const treeLayout=layout(stages);let mapHeight=treeLayout.height,mapWidth=treeLayout.width;
    const mapScroll=el('div','mx-map-scroll'),map=el('div','mx-map'),lane=el('div','mx-lane'),lines=svg('svg',{viewBox:`0 0 ${mapWidth} ${mapHeight}`,preserveAspectRatio:'none','aria-hidden':'true'});
    mapScroll.tabIndex=0;mapScroll.setAttribute('aria-label','Дерево решений. Прокручивается по вертикали и горизонтали.');
    map.style.height=mapHeight+'px';
    map.style.width=mapWidth+'px';map.style.minWidth=mapWidth+'px';eras.hidden=true;
    let zoom=1;
    const surface=el('div','mx-map-surface'),zoomBar=el('div','mx-zoom-bar');
    const changeZoom=value=>{setZoom(value);scrollToSelected();};
    const zoomOut=btn('−','',()=>changeZoom(zoom/1.2)),zoomValue=btn('100%','mx-zoom-value',()=>changeZoom(1)),zoomIn=btn('+','',()=>changeZoom(zoom*1.2));
    zoomOut.setAttribute('aria-label','Уменьшить масштаб дерева');zoomIn.setAttribute('aria-label','Увеличить масштаб дерева');zoomValue.setAttribute('aria-label','Вернуть масштаб 100%');
    zoomBar.append(zoomOut,zoomValue,zoomIn,btn('Показать всё','mx-zoom-fit',()=>{
      const viewportHeight=window.innerWidth<=760?520:window.innerWidth<=1050?580:Math.min(640,window.innerHeight*.7);
      setZoom(Math.min(1,(mapScroll.clientWidth-28)/mapWidth,(viewportHeight-28)/mapHeight));
      mapScroll.scrollLeft=0;mapScroll.scrollTop=0;
    }),el('span','mx-zoom-hint','Ctrl / ⌘ + колесо'));
    function setZoom(value,anchor){
      const next=Math.max(.05,Math.min(2,value));
      const x=anchor?.x??mapScroll.clientWidth/2,y=anchor?.y??mapScroll.clientHeight/2;
      const sourceX=(mapScroll.scrollLeft+x)/zoom,sourceY=(mapScroll.scrollTop+y)/zoom;
      zoom=next;map.style.transform=`scale(${zoom})`;
      surface.style.width=mapWidth*zoom+'px';surface.style.height=mapHeight*zoom+'px';
      mapScroll.style.setProperty('--mx-content-height',Math.ceil(mapHeight*zoom+2)+'px');
      zoomValue.textContent=Math.round(zoom*100)+'%';zoomOut.disabled=zoom<=.05;zoomIn.disabled=zoom>=2;
      mapScroll.scrollLeft=Math.max(0,sourceX*zoom-x);mapScroll.scrollTop=Math.max(0,sourceY*zoom-y);
    }
    mapScroll.addEventListener('wheel',event=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();const rect=mapScroll.getBoundingClientRect();
      setZoom(zoom*Math.exp(-event.deltaY*.003),{x:event.clientX-rect.left,y:event.clientY-rect.top});
    },{passive:false});
    mapScroll.addEventListener('keydown',event=>{
      if(event.target!==mapScroll)return;
      if(!['+','=','-','0'].includes(event.key))return;
      event.preventDefault();setZoom(event.key==='0'?1:zoom*(event.key==='-'?1/1.2:1.2));
    });
    map.append(lane,lines);surface.append(map);mapScroll.append(surface);
    const edgeLegend=el('div','mx-edge-legend');edgeLegend.setAttribute('aria-label','Итоги переходов');
    [['success','Успешно'],['failure','Неуспешно'],['inconclusive','Неопределённо'],['pending','Без итога']].forEach(([kind,label])=>{const item=el('span','mx-edge-legend-item');item.append(el('i','mx-edge-swatch '+kind),el('span','',label));edgeLegend.append(item);});
    graph.append(graphHeader,eras,zoomBar,mapScroll,edgeLegend);
    setZoom(1);
    primary.append(graph,inspector);
    const ugtScale=el('section','mx-ugt-scale mx-ugt-simple'),ugtSteps=el('div','mx-ugt-steps');
    ugtScale.setAttribute('aria-label',`Шкала УГТ. Текущий уровень ${project.ugt_level||1} из 9`);
    for(let level=1;level<=9;level++){const current=level===(Number(project.ugt_level)||1);const step=el('span','mx-ugt-step'+(current?' current':''));step.append(el('b','',String(level)));step.title=`УГТ ${level}${current?' — текущий уровень':''}`;if(current)step.setAttribute('aria-current','step');ugtSteps.append(step);}
    ugtSteps.style.setProperty('--ugt-progress',`${((Number(project.ugt_level)||1)-1)/8*100}%`);
    ugtScale.append(ugtSteps);
    const timeline=el('section','mx-timeline mx-timeline-minimal');
    timeline.setAttribute('aria-label','Шкала времени проекта');
    const timeBody=el('div','mx-time-body'),timeRows=el('div','mx-time-rows');
    const calRow=el('div','mx-time-row'),calLine=el('div','mx-calendar');
    calRow.append(calLine);
    const attRow=el('div','mx-time-row mx-att-row'),attLine=el('div','mx-attention');
    attRow.append(attLine);timeRows.append(calRow,attRow);
    timeBody.append(timeRows);
    timeline.append(timeBody);
    const extra=el('section','mx-extra');extra.hidden=true;const extraBody=el('div','mx-extra-body');extra.append(extraBody);
    const views=[['Материалы',()=>WorkflowUI.materials(extraBody,data)],['Команда',()=>WorkflowUI.team(extraBody,data)],['История',()=>WorkflowUI.history(extraBody,data)],['О проекте',()=>{
      extraBody.append(el('h2','',project.name),el('p','mx-about-summary',project.summary||''));
      const details=el('dl','mx-about-meta');
      [['Код',project.code],['Область',project.field||'Не указана'],['Регион',project.region||'Не указан'],['Уровень готовности',`УГТ ${project.ugt_level||1}`]].forEach(([name,value])=>{const item=el('div');item.append(el('dt','',name),el('dd','',value));details.append(item);});
      extraBody.append(details,el('h3','','Описание исследования'),el('p','mx-about-description',project.description||'Описание пока не добавлено.'));
    }]];
    if(data.can_ask||data.can_review)views.push(['Вопросы',()=>WorkflowUI.questions(extraBody,data)]);
    sectionTabs.setAttribute('role','tablist');
    const markTabs=name=>[...sectionTabs.children].forEach(x=>{x.classList.toggle('active',x.textContent===name);x.setAttribute('aria-selected',String(x.textContent===name));});
    sectionTabs.append(btn('Дерево решений','active',()=>{extra.hidden=true;primary.hidden=false;timeline.hidden=false;ugtScale.hidden=false;utility.hidden=false;markTabs('Дерево решений');scrollToSelected();}));
    views.forEach(([name,fn])=>{
      const show=()=>{extra.hidden=false;primary.hidden=true;timeline.hidden=true;ugtScale.hidden=true;utility.hidden=true;markTabs(name);extraBody.replaceChildren();fn();};
      sectionTabs.append(btn(name,'',show));
    });
    [...sectionTabs.children].forEach(x=>x.setAttribute('role','tab'));markTabs('Дерево решений');
    const workflow=el('div','mx-workflow');WorkflowUI.controls(workflow,data);
    host.append(top,hero,sectionTabs,utility,primary,ugtScale,timeline,extra,workflow);
    function stageDate(s){return dt(s.due_at)||dt(s.completed_at);}
    function coordinates(){
      return treeLayout.points;
    }
    function resizeMap(){
      mapWidth=Math.max(treeLayout.width,...[...treeLayout.points.values()].map(p=>p.x+265));
      mapHeight=Math.max(treeLayout.height,...[...treeLayout.points.values()].map(p=>p.y+210));
      map.style.width=map.style.minWidth=mapWidth+'px';map.style.height=mapHeight+'px';
      lines.setAttribute('viewBox',`0 0 ${mapWidth} ${mapHeight}`);
      surface.style.width=mapWidth*zoom+'px';surface.style.height=mapHeight*zoom+'px';
      mapScroll.style.setProperty('--mx-content-height',Math.ceil(mapHeight*zoom+2)+'px');
    }
    function drawGraph(){
      map.querySelectorAll('.mx-node,.mx-root,.mx-empty').forEach(x=>x.remove());lines.replaceChildren();
      const points=coordinates(),root={x:95,y:mapHeight/2},origin=el('div','mx-root');
      origin.style.left=root.x/mapWidth*100+'%';origin.style.top=root.y/mapHeight*100+'%';
      const focusPoint=points.get(selected?.public_id);lane.style.left=(focusPoint?focusPoint.x-45:0)+'px';lane.style.width='290px';
      const countWord=stages.length%100>=11&&stages.length%100<=14?'событий':stages.length%10===1?'событие':stages.length%10>=2&&stages.length%10<=4?'события':'событий';
      origin.append(el('span','mx-root-dot','0'),el('strong','',project.code),el('small','',stages.length+' '+countWord));map.append(origin);
      stages.forEach(s=>{if(filter!=='all'&&filter!==s.status)return;const p=points.get(s.public_id);if(!p)return;const parent=points.get(s.parent_public_id)||root,bend=Math.max(35,(p.x-parent.x)*.45);
        const edgeOutcome=['success','failure','inconclusive'].includes(s.outcome)?s.outcome:'pending';
        lines.append(svg('path',{d:'M '+parent.x+' '+parent.y+' C '+(parent.x+bend)+' '+parent.y+', '+(p.x-bend)+' '+p.y+', '+p.x+' '+p.y,class:`mx-edge edge-${edgeOutcome}${s.public_id===selected?.public_id?' edge-selected':''}`}));
        const dim=query&&!((s.title||'')+' '+(s.description||'')).toLowerCase().includes(query);
        const selectStage=event=>{const keyboard=event?.detail===0;selected=s;center=stageDate(s)||center;draw();scrollToSelected();if(keyboard)[...map.querySelectorAll('.mx-node-dot')].find(button=>button.dataset.stageId===s.public_id)?.focus();};
        const n=el('div','mx-node '+s.status+' outcome-'+edgeOutcome+(selected?.public_id===s.public_id?' selected':'')+(dim?' dimmed':''));
        n.style.left=p.x/mapWidth*100+'%';n.style.top=p.y/mapHeight*100+'%';n.setAttribute('role','group');n.setAttribute('aria-label',s.title+', '+state[s.status]);
        const caption=el('div','mx-node-text');
        caption.append(el('small','mx-node-code','D'+(s.position||'·')+' · '+(stageDate(s)?.getFullYear()||'без даты')),el('strong','',s.title),el('small','mx-node-description',s.description||state[s.status]));
        if(s.outcome)caption.append(el('small','mx-event-outcome '+s.outcome,{success:'Успешно',failure:'Неуспешно',inconclusive:'Неопределённо'}[s.outcome]));
        if(s.status==='in_progress'){
          const progress=el('span','mx-node-progress');
          progress.append(el('small','','Проверки: '+(s.progress||0)+'%'),el('i'));progress.style.setProperty('--value',(s.progress||0)+'%');
          caption.append(progress,el('small','mx-node-owner',[(s.owner_name||'Не назначен'),shortDate(stageDate(s))].join(' · ')));
        }
        caption.append(btn('Открыть событие →','mx-node-open',()=>{selectStage();openEvent(s);}));
        const dot=btn('D'+(s.position||'·'),'mx-node-dot',selectStage);
        dot.dataset.stageId=s.public_id;
        dot.setAttribute('aria-label',`Событие D${s.position||'·'}: ${s.title}, ${state[s.status]}`);
        dot.setAttribute('aria-pressed',String(selected?.public_id===s.public_id));
        n.append(dot,caption);map.append(n);
      });
      if(!stages.length)map.append(el('p','mx-empty','В дереве пока нет событий.'));
    }
    function drawInspector(){
      inspector.replaceChildren();
      const visible=filter==='all'?stages:stages.filter(stage=>stage.status===filter);
      positionText.textContent=selected?`${Math.max(0,visible.findIndex(stage=>stage.public_id===selected.public_id))+1} / ${visible.length}`:`0 / ${visible.length}`;
      if(!selected){inspector.append(el('b','mx-kicker','СОБЫТИЕ'),el('h2','','Выберите этап'),el('p','','Нажмите на событие в дереве.'));if(data.can_edit)inspector.append(btn('+ Добавить событие','mx-open',()=>WorkflowUI.stage(data)));return;}
      const docs=(data.materials||[]).filter(m=>m.stage_public_id===selected.public_id);
      const status=el('span','mx-inspector-status '+selected.status,state[selected.status]||'этап');
      const heading=el('div','mx-inspector-heading');heading.append(el('b','mx-kicker','СОБЫТИЕ D'+(selected.position||'·')),status);
      inspector.append(heading,el('h2','',selected.title));
      if(selected.outcome)inspector.append(el('p','mx-event-outcome '+selected.outcome,'Итог: '+{success:'Успешно',failure:'Неуспешно',inconclusive:'Неопределённо'}[selected.outcome]));
      inspector.append(el('small','mx-label','ЦЕЛЬ ЭТАПА'),el('p','mx-body',selected.description||'Цель этапа пока не заполнена.'));
      const meta=el('dl','mx-detail-meta');
      [['Ответственная',selected.owner_name||'Не назначена'],['Контрольная дата',shortDate(stageDate(selected))]].forEach(([name,value])=>{meta.append(el('dt','',name),el('dd','',value));});
      inspector.append(meta);
      const criteria=(selected.criteria_text||'').split('\n').map(x=>x.trim()).filter(Boolean);
      const criteriaHead=el('div','mx-detail-head');criteriaHead.append(el('h3','','Критерии готовности'),el('span','',criteria.length?criteria.filter(x=>x.startsWith('[x]')).length+'/'+criteria.length:'—'));inspector.append(criteriaHead);
      if(criteria.length)criteria.forEach(item=>{const done=item.startsWith('[x]'),row=el('div','mx-criterion');row.append(el('span',done?'done':'',done?'✓':''),el('span','',item.replace(/^\[[x ]\]\s*/i,'')));inspector.append(row);});
      else inspector.append(el('p','mx-criteria-empty','Критерии пока не указаны.'));
      appendStageChoices(inspector,selected);
      const attention=selected.attention_note||(!stageDate(selected)&&selected.status==='in_progress'?'Контрольная дата пока не назначена.':'');
      if(attention){const box=el('div','mx-attention-note');box.append(el('b','','• Требует внимания'),el('span','',attention));inspector.append(box);}
      const materialsHead=el('div','mx-detail-head');materialsHead.append(el('h3','','Материалы'),el('span','',String(docs.length)));inspector.append(materialsHead);
      if(docs.length)docs.forEach(m=>inspector.append(btn('↗ '+m.title,'mx-material',()=>WorkflowUI.run(()=>WorkflowUI.download(data,m)))));
      else inspector.append(el('p','mx-criteria-empty','Материалов пока нет.'));
      inspector.append(btn('Открыть событие','mx-open',()=>openEvent(selected)));
      if(data.can_edit)inspector.append(btn('Редактировать этап','mx-edit-stage',()=>WorkflowUI.stage(data,selected)));
    }
    function openEvent(stage){
      if(stage)location.hash=`event/${project.public_id}/${stage.public_id}`;
    }
    function appendStageChoices(host,stage){
      if(!stage.choices?.length)return;
      host.append(el('h3','mx-choice-heading','Варианты результата'));
      const list=el('div','mx-choice-list');
      stage.choices.forEach((choice,index)=>{const row=el('label','mx-choice-row');const radio=el('input');radio.type='radio';radio.disabled=true;radio.checked=stage.selected_choice===index;row.append(radio,el('span','',choice));list.append(row);});
      host.append(list);
    }
    function drag(event,kind){
      if(!lensBounds||event.button!==0)return;
      host._lensDragCleanup?.();
      timeline.classList.add('is-dragging');
      event.preventDefault();event.stopPropagation();
      const target=event.currentTarget,id=event.pointerId,x=event.clientX;
      const initialCenter=+center,initialMonths=months;
      const initialStart=initialCenter-months*monthMs/2,initialEnd=initialCenter+months*monthMs/2;
      const rect=target.closest('.mx-attention,.mx-calendar').getBoundingClientRect();
      const duration=lensBounds.max-lensBounds.min;
      let frame=0,pendingX=x;
      const paint=()=>{
        frame=0;
        const range=moveLens(initialStart,initialEnd,(pendingX-x)/rect.width*duration,kind,lensBounds.min,lensBounds.max,monthMs,24*monthMs);
        center=new Date((range.start+range.end)/2);months=(range.end-range.start)/monthMs;updateLensView();
      };
      const move=e=>{if(e.pointerId!==id)return;pendingX=e.clientX;if(!frame)frame=requestAnimationFrame(paint);};
      const cleanup=()=>{
        cancelAnimationFrame(frame);frame=0;timeline.classList.remove('is-dragging');
        target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',finish);target.removeEventListener('pointercancel',cancel);target.removeEventListener('lostpointercapture',cancel);
        window.removeEventListener('blur',cancel);
        if(target.hasPointerCapture(id))target.releasePointerCapture(id);
        host._lensDragCleanup=null;
      };
      const finish=e=>{if(e.pointerId!==id)return;pendingX=e.clientX;cancelAnimationFrame(frame);paint();cleanup();};
      const cancel=()=>{center=new Date(initialCenter);months=initialMonths;cleanup();updateLensView();};
      target.setPointerCapture(id);
      target.addEventListener('pointermove',move);target.addEventListener('pointerup',finish);target.addEventListener('pointercancel',cancel);target.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
      host._lensDragCleanup=cleanup;
    }
    function drawTimeline(){
      if(!dated.length){
        timeBody.replaceChildren(el('p','mx-timeline-empty','Добавьте контрольные даты событий, чтобы увидеть развитие проекта на шкале времени.'));
        return;
      }
      calLine.replaceChildren();attLine.replaceChildren();
      const first=dated[0]||center,last=dated.at(-1)||center;
      const begin=new Date(first.getFullYear()-1,0,1),end=new Date(last.getFullYear()+1,11,1),totalMonths=Math.max(1,(end.getFullYear()-begin.getFullYear())*12+end.getMonth()-begin.getMonth());
      calendarSpanDays=(end-begin)/86400000;
      const pct=d=>Math.max(0,Math.min(100,(d-begin)/(end-begin)*100));
      lensBounds={min:+begin,max:+end};
      const half=months*monthMs/2;
      center=new Date(Math.max(+begin+half,Math.min(+end-half,+center)));
      const centerX=pct(center),size=months*monthMs/(end-begin)*100;
      const lo=+center-half,hi=+center+half;
      // Calendar marks stay anchored. Only the selected windows move.
      const focusSize=size,focusLeft=centerX-size/2;
      const scaled=pct;
      const ticks=[];
      for(let i=0;i<=totalMonths;i+=Math.max(1,Math.ceil(totalMonths/8)))ticks.push(new Date(begin.getFullYear(),begin.getMonth()+i,1));
      if(+ticks.at(-1)!==+end)ticks.push(end);
      ticks.forEach((d,i)=>{const tick=el('span','mx-tick');tick.style.left=(i===0?0:i===ticks.length-1?100:scaled(d))+'%';tick.dataset.labelPriority=String(i===0||i===ticks.length-1?2:1);tick.append(el('i'),el('small','',i===0||i===ticks.length-1?String(d.getFullYear()):d.toLocaleDateString('ru-RU',{month:'short',year:'2-digit'})));calLine.append(tick);});
      const calWindow=el('div','mx-calendar-window');calWindow.style.left=focusLeft+'%';calWindow.style.width=focusSize+'%';calWindow.onpointerdown=e=>drag(e,'center');calLine.append(calWindow);
      const cursor=el('span','mx-lens-cursor');cursor.style.left=centerX+'%';cursor.setAttribute('aria-hidden','true');calLine.append(cursor);
      stages.filter(stageDate).forEach(s=>{const mark=btn('','mx-calendar-event'+(s===selected?' selected':''),()=>{selected=s;center=stageDate(s);draw();scrollToSelected();});mark.style.left=scaled(stageDate(s))+'%';mark.title=`D${s.position} · ${s.title}`;mark.setAttribute('aria-label',`Фокус на событии D${s.position}: ${s.title}`);calLine.append(mark);});
      const centerKey=(event,selector)=>{const delta={ArrowLeft:-1,ArrowRight:1,PageUp:-12,PageDown:12}[event.key];if(delta===undefined&&event.key!=='Home')return;event.preventDefault();center=event.key==='Home'?new Date():new Date(center.getFullYear(),center.getMonth()+delta,1);updateLensView();};
      const describeCenter=(node,selector)=>{node.tabIndex=0;node.setAttribute('role',selector==='calendar'?'slider':'group');node.setAttribute('aria-label',selector==='calendar'?'Дата фокуса на календаре':`Фокус на шкале внимания: ${label(center)}`);if(selector==='calendar'){node.setAttribute('aria-valuemin','0');node.setAttribute('aria-valuemax',String(totalMonths));node.setAttribute('aria-valuenow',String(Math.max(0,Math.min(totalMonths,(center.getFullYear()-begin.getFullYear())*12+center.getMonth()-begin.getMonth()))));node.setAttribute('aria-valuetext',label(center));}node.onkeydown=event=>centerKey(event,selector);};
      describeCenter(calWindow,'calendar');
      // Decorative hatch matches the source vector strip; it is not a data chart.
      const hatch=el('div','mx-lens-hatch');hatch.setAttribute('aria-hidden','true');
      for(let i=0;i<88;i++){const bar=el('i');bar.style.height=(5+(i*7)%22)+'px';hatch.append(bar);}attLine.append(hatch);
      for(let year=begin.getFullYear();year<=end.getFullYear();year++){const tick=el('span','mx-lens-year',String(year));tick.style.left=pct(new Date(year,6,1))+'%';if(year===center.getFullYear())tick.classList.add('current');attLine.append(tick);}
      const band=el('div','mx-att-window');band.style.left=Math.max(0,Math.min(100-size,centerX-size/2))+'%';band.style.width=size+'%';band.onpointerdown=e=>drag(e,'center');
      describeCenter(band,'attention');
      const left=el('span','mx-handle'),right=el('span','mx-handle');left.title='Уменьшить окно';right.title='Увеличить окно';left.onpointerdown=e=>drag(e,'left');right.onpointerdown=e=>drag(e,'right');
      [left,right].forEach((handle,index)=>{handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label',`${index?'Увеличить':'Уменьшить'} окно линзы · ${Math.round(months*10)/10} мес.`);handle.onkeydown=event=>{if(!['Enter',' ','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();const range=moveLens(+center-months*monthMs/2,+center+months*monthMs/2,(event.key==='ArrowLeft'?-1:1)*monthMs,index?'right':'left',lensBounds.min,lensBounds.max,monthMs,24*monthMs);center=new Date((range.start+range.end)/2);months=(range.end-range.start)/monthMs;updateLensView();};});
      band.append(left,right);attLine.append(band);

      updateLensView();
      requestAnimationFrame(fitTimelineLabels);

    }
    function updateLensView(){
      if(!lensBounds)return;
      const half=months*monthMs/2;center=new Date(Math.max(lensBounds.min+half,Math.min(lensBounds.max-half,+center)));
      const span=lensBounds.max-lensBounds.min,c=(+center-lensBounds.min)/span*100,w=months*monthMs/span*100;
      const upper=calLine.querySelector('.mx-calendar-window'),lower=attLine.querySelector('.mx-att-window');
      const wide=w;
      upper.style.left=Math.max(0,Math.min(100-wide,c-wide/2))+'%';upper.style.width=wide+'%';
      lower.style.left=(c-w/2)+'%';lower.style.width=w+'%';
      calLine.querySelector('.mx-lens-cursor').style.left=c+'%';
      upper.setAttribute('aria-valuenow',String(Math.round((+center-lensBounds.min)/monthMs)));
      const rangeDate=value=>new Date(value).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
      upper.title=lower.title=`${rangeDate(Math.max(lensBounds.min,Math.round(+center-half)))} — ${rangeDate(Math.min(lensBounds.max,Math.round(+center+half)))}`;
      upper.setAttribute('aria-valuetext',label(center));lower.setAttribute('aria-label',`Фокус на шкале внимания: ${label(center)}`);
      attLine.querySelectorAll('.mx-lens-year').forEach(n=>n.classList.toggle('current',Number(n.textContent)===center.getFullYear()));
      attLine.querySelectorAll('.mx-handle').forEach((n,i)=>n.setAttribute('aria-label',`${i?'Увеличить':'Уменьшить'} окно линзы · ${Math.round(months*10)/10} мес.`));
    }
    function fitTimelineLabels(){
      if(!calLine.isConnected||!calLine.clientWidth)return;
      function fit(track,items){
        const bounds=track.getBoundingClientRect(),occupied=[];
        items.forEach(({node})=>{node.style.visibility='visible';node.style.translate='0px';});
        items.sort((a,b)=>b.priority-a.priority).forEach(({node})=>{
          let rect=node.getBoundingClientRect();
          const shift=rect.left<bounds.left?bounds.left-rect.left:rect.right>bounds.right?bounds.right-rect.right:0;
          node.style.translate=shift+'px';rect=node.getBoundingClientRect();
          if(occupied.some(r=>rect.left<r.right+12&&rect.right>r.left-12))node.style.visibility='hidden';
          else occupied.push({left:rect.left,right:rect.right});
        });
      }
      fit(calLine,[...calLine.querySelectorAll('.mx-tick')].map(t=>({node:t.querySelector('small'),priority:Number(t.dataset.labelPriority)})));
      fit(attLine,[...attLine.querySelectorAll('.mx-lens-year')].map(node=>({node,priority:node.classList.contains('current')?2:1})));
    }
    const lensResize=new ResizeObserver(fitTimelineLabels);lensResize.observe(calLine);host._lensResize=lensResize;
    function draw(){drawGraph();drawInspector();drawTimeline();}
    function scrollToSelected(){
      if(!selected)return;
      const point=coordinates().get(selected.public_id);
      if(!point)return;
      requestAnimationFrame(()=>{
        mapScroll.scrollLeft=Math.max(0,point.x*zoom-mapScroll.clientWidth*.39);
        mapScroll.scrollTop=Math.max(0,point.y*zoom-mapScroll.clientHeight*.43);
      });
    }
    draw();
    scrollToSelected();
  }
  return {render,layout,moveLens};
})();
