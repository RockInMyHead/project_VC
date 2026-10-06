"""Role-scoped project workflows. All commands run in a single transaction."""
import base64
import hashlib
import json
import re
import sqlite3
from datetime import date
from urllib.parse import parse_qs
from db import public_id, utc_now, hash_password

CARD = ('name','summary','description','field','region','ugt_level','status')
class Problem(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

def require(condition, message='У вас нет доступа к этому действию.', status=403):
    if not condition: raise Problem(status, message)

def audit(db, user, action, pid, metadata=None):
    db.execute('INSERT INTO audit_log(public_id,actor_id,action,entity_type,entity_public_id,metadata_json) VALUES(?,?,?,\'project\',?,?)', (public_id('aud'),user['id'],action,pid,json.dumps(metadata or {},ensure_ascii=False)))

def managed(user,p):
    return user['role_code']=='super_admin' or user['role_code']=='fund_staff' and p['fund_manager_id']==user['id']

def owner_or_manager(user,p):
    return managed(user,p) or user['role_code']=='founder' and p['founder_id']==user['id']

def member_role(db,user,p):
    if user['role_code']!='founder': return None
    row=db.execute('SELECT member_role FROM project_members WHERE project_id=? AND user_id=?',(p['id'],user['id'])).fetchone()
    return row['member_role'] if row else None

def private_visible(db,user,p):
    return owner_or_manager(user,p) or member_role(db,user,p) is not None

def editable(db,user,p):
    return owner_or_manager(user,p) or member_role(db,user,p)=='researcher'

def get_project(db,user,pid):
    require(user, 'Войдите в систему.',401)
    p=db.execute('SELECT * FROM projects WHERE public_id=? OR slug=?',(pid,pid)).fetchone()
    require(p is not None,'Проект не найден.',404)
    visible=private_visible(db,user,p) or p['status'] in ('active','paused','completed') and db.execute("SELECT 1 FROM tree_versions WHERE project_id=? AND state='published'",(p['id'],)).fetchone()
    require(visible,'Проект не найден или недоступен.',404)
    return p

def version(db,p,private=True):
    return db.execute("SELECT * FROM tree_versions WHERE project_id=? AND (? OR state='published') ORDER BY version_number DESC LIMIT 1",(p['id'],private)).fetchone()

def snapshot(p): return {k:p[k] for k in CARD}

def notify(db,p,kind,title,body,users=None):
    recipients=set(users if users is not None else [r[0] for r in db.execute('SELECT user_id FROM project_subscriptions WHERE project_id=?',(p['id'],))])
    if users is None: recipients.update(x for x in (p['founder_id'],p['fund_manager_id']) if x)
    for uid in recipients:
        db.execute("INSERT INTO notifications(public_id,user_id,type,title,body,entity_type,entity_public_id) VALUES(?,?,?,?,?,'project',?)",(public_id('ntf'),uid,kind,title,body,p['public_id']))

def project_detail(db,user,pid):
    p=get_project(db,user,pid); private=private_visible(db,user,p); v=version(db,p,private)
    card=dict(p); card.pop('founder_id');card.pop('fund_manager_id');card.pop('id')
    if private and v and v['card_json']: card.update(json.loads(v['card_json']))
    card['founder_name']=db.execute('SELECT full_name FROM users WHERE id=?',(p['founder_id'],)).fetchone()[0]
    stages=[dict(r) for r in db.execute('SELECT s.public_id,parent.public_id parent_public_id,s.position,s.title,s.description,s.criteria_text,s.attention_note,s.status,s.progress,s.ugt_level,s.choice_options_json,s.selected_choice,s.outcome,s.outcome_note,s.outcome_at,s.map_x,s.map_y,s.due_at,s.started_at,s.completed_at,u.full_name owner_name,u.public_id owner_public_id FROM stages s LEFT JOIN stages parent ON parent.id=s.parent_stage_id LEFT JOIN users u ON u.id=s.owner_id WHERE s.tree_version_id=? ORDER BY s.position,s.id',(v['id'],))] if v else []
    for stage in stages: stage['choices']=json.loads(stage.pop('choice_options_json'))
    materials=[dict(r) for r in db.execute('SELECT e.public_id,e.title,e.mime_type,e.byte_size,s.public_id stage_public_id FROM evidence e JOIN stages s ON s.id=e.stage_id WHERE s.tree_version_id=?',(v['id'],))] if v else []
    team=[dict(r) for r in db.execute('''SELECT DISTINCT u.public_id,u.full_name,u.organization,r.name role_name,
      CASE WHEN u.id=p.founder_id THEN 'owner' WHEN u.id=p.fund_manager_id THEN 'manager' ELSE pm.member_role END member_role
      FROM projects p JOIN users u ON u.id IN (p.founder_id,p.fund_manager_id) OR u.id IN
      (SELECT user_id FROM project_members WHERE project_id=p.id)
      JOIN roles r ON r.id=u.role_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=u.id
      WHERE p.id=?''',(p['id'],))]
    questions=[]
    if managed(user,p) or user['role_code']=='investor':
        for q in db.execute('SELECT q.*,u.full_name author FROM project_questions q JOIN users u ON u.id=q.author_id WHERE q.project_id=? AND (? OR q.author_id=?) ORDER BY q.id DESC',(p['id'],managed(user,p),user['id'])):
            item={k:q[k] for k in ('public_id','body','status','created_at','author')}
            item['replies']=[dict(r) for r in db.execute('SELECT r.body,r.created_at,u.full_name author FROM question_replies r JOIN users u ON u.id=r.author_id WHERE question_id=? ORDER BY r.id',(q['id'],))];questions.append(item)
    if private:
        history=[dict(r) for r in db.execute("SELECT a.action,a.created_at,a.metadata_json,u.full_name author FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='project' AND a.entity_public_id=? AND a.action!='project.viewed' ORDER BY a.id DESC LIMIT 200",(p['public_id'],))]
    else:
        history=[{'action':'project.published','created_at':r['published_at'],'author':r['author'],'metadata_json':json.dumps({'version':r['version_number'],'summary':r['change_summary']})} for r in db.execute("SELECT v.*,u.full_name author FROM tree_versions v LEFT JOIN users u ON u.id=v.reviewed_by WHERE project_id=? AND state='published' ORDER BY version_number DESC",(p['id'],))]
        audit(db,user,'project.viewed',p['public_id'])
    return {'project':card,'stages':stages,'materials':materials,'team':team,'questions':questions,'history':history,'tree_version':{k:v[k] for k in ('public_id','version_number','state','revision','change_summary','review_comment','published_at')} if v else None,'can_edit':editable(db,user,p) and bool(v and v['state']=='draft'),'can_conclude':user['role_code']=='founder' and p['founder_id']==user['id'] and bool(v and v['state']=='draft'),'can_manage':owner_or_manager(user,p),'can_manage_team':owner_or_manager(user,p),'can_review':managed(user,p),'can_ask':user['role_code']=='investor','subscribed':bool(db.execute('SELECT 1 FROM project_subscriptions WHERE project_id=? AND user_id=?',(p['id'],user['id'])).fetchone())}

def project_list(db,user):
    require(user,'Войдите в систему.',401)
    result=[]
    for p in db.execute('SELECT * FROM projects ORDER BY updated_at DESC'):
        if not (private_visible(db,user,p) or user['role_code']=='investor' and p['status'] in ('active','paused','completed')): continue
        v=version(db,p,private_visible(db,user,p))
        if not v: continue
        card=dict(p)
        if private_visible(db,user,p) and v['card_json']: card.update(json.loads(v['card_json']))
        item={k:card[k] for k in ('public_id','code','name','summary','field','region','status','ugt_level','updated_at','last_published_at')}
        item['manager_public_id']=db.execute('SELECT public_id FROM users WHERE id=?',(p['fund_manager_id'],)).fetchone()[0] if p['fund_manager_id'] else None
        item['review_state']=v['state'];item['founder_name']=db.execute('SELECT full_name FROM users WHERE id=?',(p['founder_id'],)).fetchone()[0]
        item['publications']=[dict(r) for r in db.execute("SELECT tv.version_number,tv.published_at,COALESCE(ROUND(AVG(s.progress)),0) progress FROM tree_versions tv LEFT JOIN stages s ON s.tree_version_id=tv.id WHERE tv.project_id=? AND tv.state='published' GROUP BY tv.id ORDER BY tv.version_number",(p['id'],))]
        item.update(dict(db.execute("SELECT COUNT(*) stage_count,COALESCE(SUM(status='completed'),0) completed_stage_count,COALESCE(ROUND(AVG(progress)),0) average_progress FROM stages WHERE tree_version_id=?",(v['id'],)).fetchone()))
        result.append(item)
    return {'items':result}

def public_project_previews(db):
    """Only published project cards and stage labels for the guest preview."""
    rows=db.execute("""SELECT p.public_id,p.code,p.name,p.summary,p.field,p.ugt_level,p.status,
        v.id version_id,v.card_json FROM projects p JOIN tree_versions v ON v.id=(
        SELECT id FROM tree_versions WHERE project_id=p.id AND state='published'
        ORDER BY version_number DESC LIMIT 1)
        WHERE p.status IN ('active','paused','completed')
        ORDER BY p.last_published_at DESC LIMIT 30""").fetchall()
    items=[]
    for row in rows:
        card=json.loads(row['card_json'] or '{}')
        project={key:card.get(key,row[key]) for key in ('code','name','summary','field','ugt_level')}
        project['public_id']=row['public_id']
        project['status']=row['status']
        project['stages']=[dict(stage) for stage in db.execute(
            "SELECT position,title,status,progress FROM stages WHERE tree_version_id=? ORDER BY position,id LIMIT 40",
            (row['version_id'],))]
        items.append(project)
    return {'items':items}

def project_comparison_list(db,user):
    require(user,'Войдите в систему.',401)
    items=project_list(db,user)['items']
    known={item['public_id'] for item in items}
    for p in db.execute("SELECT * FROM projects WHERE status IN ('active','paused','completed') ORDER BY updated_at DESC"):
        if p['public_id'] in known: continue
        v=version(db,p,False)
        if not v: continue
        items.append({
            'public_id':p['public_id'],'code':p['code'],'name':p['name'],
            'summary':p['summary'],'field':p['field'],'region':p['region'],
            'status':p['status'],'ugt_level':p['ugt_level'],'updated_at':p['updated_at'],
            'last_published_at':p['last_published_at'],'review_state':'published',
            'stage_count':db.execute('SELECT COUNT(*) FROM stages WHERE tree_version_id=?',(v['id'],)).fetchone()[0],
            'completed_stage_count':db.execute("SELECT COUNT(*) FROM stages WHERE tree_version_id=? AND status='completed'",(v['id'],)).fetchone()[0],
        })
        known.add(p['public_id'])
    return {'items':items}

def founder_changes(db,user,query=''):
    require(user and user['role_code']=='founder','У вас нет доступа к истории изменений.',403)
    params=parse_qs(query)
    value=lambda key:params.get(key,[''])[0].strip()
    clauses=["a.entity_type='project'","a.action!='project.viewed'",'''(p.founder_id=? OR EXISTS
        (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=?))''']
    args=[user['id'],user['id']]
    project=value('project')
    if project:
        clauses.append('p.public_id=?');args.append(project)
    search=value('q')[:100]
    if search:
        pattern='%'+search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        clauses.append("(a.action LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR a.metadata_json LIKE ? ESCAPE '\\')")
        args.extend([pattern]*5)
    before=value('before')
    if before:
        require(before.isdecimal() and len(before)<=18 and int(before)>0,'Некорректная страница изменений.',422)
        clauses.append('a.id<?');args.append(int(before))
    rows=db.execute('''SELECT a.id,a.public_id,a.action,a.created_at,a.metadata_json,u.full_name author,
        p.public_id project_public_id,p.code project_code,p.name project_name
        FROM audit_log a JOIN projects p ON p.public_id=a.entity_public_id
        LEFT JOIN users u ON u.id=a.actor_id
        WHERE '''+' AND '.join(clauses)+' ORDER BY a.id DESC LIMIT 31',args).fetchall()
    items=[dict(row) for row in rows[:30]]
    cursor=items[-1]['id'] if len(rows)>30 else None
    for item in items:item.pop('id')
    return {'items':items,'next_cursor':cursor}

def integer(value,low,high,label):
    try: result=int(value)
    except (ValueError,TypeError): raise Problem(422,f'Проверьте поле «{label}».')
    require(low<=result<=high,f'«{label}»: укажите число от {low} до {high}.',422);return result

def clone(db,user,p,v):
    require(v['state'] in ('published','rejected'),'Рабочая версия уже существует.',409)
    vid=public_id('tree'); card=v['card_json'] or json.dumps(snapshot(p),ensure_ascii=False)
    cursor=db.execute("INSERT INTO tree_versions(public_id,project_id,version_number,created_by,card_json) VALUES(?,?,?,?,?)",(vid,p['id'],v['version_number']+1,user['id'],card)); tid=cursor.lastrowid
    mapping={}
    rows=list(db.execute('SELECT * FROM stages WHERE tree_version_id=? ORDER BY position,id',(v['id'],)))
    for s in rows:
        columns=['position','branch_code','title','description','criteria_text','attention_note','status','progress','ugt_level','choice_options_json','selected_choice','outcome','outcome_note','outcome_at','map_x','map_y','owner_id','started_at','due_at','completed_at']
        mapping[s['id']]=db.execute(f"INSERT INTO stages(public_id,tree_version_id,{','.join(columns)}) VALUES({','.join('?' for _ in range(len(columns)+2))})",(public_id('stg'),tid,*[s[k] for k in columns])).lastrowid
    for s in rows:
        db.execute('UPDATE stages SET parent_stage_id=? WHERE id=?',(mapping.get(s['parent_stage_id']),mapping[s['id']]))
        for e in db.execute('SELECT * FROM evidence WHERE stage_id=?',(s['id'],)):
            db.execute('INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)',(public_id('doc'),mapping[s['id']],e['title'],e['storage_key'],e['mime_type'],e['byte_size'],e['checksum_sha256'],e['uploaded_by']))
    audit(db,user,'tree.draft_created',p['public_id'],{'version':v['version_number']+1});return {'status':'draft'}

def project_command(db,user,pid,action,data):
    p=get_project(db,user,pid); v=version(db,p,True)
    changes={}
    if action=='team':
        require(owner_or_manager(user,p))
        target=db.execute('SELECT u.id,u.full_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=? AND u.status=\'active\' AND r.code=\'founder\'',(data.get('user_id'),)).fetchone()
        require(target and target['id']!=p['founder_id'],'Выберите активного участника из основателей.',422)
        role=data.get('member_role')
        require(role in ('researcher','viewer'),'Выберите доступ участника.',422)
        if data.get('enabled',True):
            db.execute('INSERT INTO project_members(project_id,user_id,member_role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET member_role=excluded.member_role',(p['id'],target['id'],role))
            kind='team.member_added'
        else:
            db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(p['id'],target['id']))
            kind='team.member_removed'
        db.execute('UPDATE projects SET updated_at=? WHERE id=?',(utc_now(),p['id']))
        audit(db,user,kind,pid,{'member':data['user_id'],'role':role})
        notify(db,p,'team','Изменён доступ к проекту',p['name'],[target['id']])
        return {'ok':True}
    if action=='subscribe':
        if data.get('enabled',True): db.execute('INSERT OR IGNORE INTO project_subscriptions VALUES(?,?)',(p['id'],user['id']))
        else: db.execute('DELETE FROM project_subscriptions WHERE project_id=? AND user_id=?',(p['id'],user['id']))
        return {'ok':True}
    if action=='questions':
        require(user['role_code']=='investor');body=str(data.get('body','')).strip();require(2<=len(body)<=5000,'Введите вопрос от 2 до 5000 символов.',422)
        qid=public_id('qst');db.execute('INSERT INTO project_questions(public_id,project_id,author_id,body) VALUES(?,?,?,?)',(qid,p['id'],user['id'],body))
        recipients=[p['fund_manager_id']] if p['fund_manager_id'] else [r[0] for r in db.execute('SELECT id FROM users WHERE role_id=4 AND status=\'active\'')]
        notify(db,p,'question','Новый вопрос',body,recipients);audit(db,user,'question.created',pid);return {'question_id':qid}
    if action=='reply':
        require(managed(user,p));q=db.execute('SELECT * FROM project_questions WHERE public_id=? AND project_id=?',(data.get('question_id'),p['id'])).fetchone();body=str(data.get('body','')).strip();require(q and 2<=len(body)<=5000,'Выберите вопрос и введите ответ.',422)
        db.execute('INSERT INTO question_replies(public_id,question_id,author_id,body) VALUES(?,?,?,?)',(public_id('rep'),q['id'],user['id'],body));db.execute("UPDATE project_questions SET status='answered',updated_at=? WHERE id=?",(utc_now(),q['id']))
        notify(db,p,'answer','Ответ на ваш вопрос',body,[q['author_id']]);audit(db,user,'question.answered',pid);return {'ok':True}
    require(editable(db,user,p));require(v is not None,'Дерево отсутствует.',409)
    if data.get('revision') is not None: require(data['revision']==v['revision'],'Проект уже изменён. Обновите страницу перед сохранением.',409)
    if action=='draft': return clone(db,user,p,v)
    if action in ('publish','reject'):
        require(managed(user,p));require(v['state']=='in_review','Эта версия не ожидает проверки.',409)
        comment=str(data.get('comment','')).strip()[:2000]
        require(action!='reject' or len(comment)>=2,'Укажите, что нужно исправить.',422)
        db.execute('UPDATE tree_versions SET state=?,review_comment=?,reviewed_by=?,reviewed_at=?,published_at=?,revision=revision+1 WHERE id=?',('published' if action=='publish' else 'rejected',comment,user['id'],utc_now(),utc_now() if action=='publish' else None,v['id']))
        if action=='publish':
            card=json.loads(v['card_json']) if v['card_json'] else snapshot(p);card['status']='active' if card['status']=='draft' else card['status']
            db.execute(f"UPDATE projects SET {','.join(k+'=?' for k in CARD)},last_published_at=? WHERE id=?",(*[card[k] for k in CARD],utc_now(),p['id']))
        notify(db,p,'publication' if action=='publish' else 'review','Проект опубликован' if action=='publish' else 'Нужны исправления',comment or p['name'],None if action=='publish' else [p['founder_id']])
        audit(db,user,'project.published' if action=='publish' else 'tree.rejected',pid,{'version':v['version_number'],'comment':comment});return {'ok':True}
    require(v['state']=='draft','Изменять можно только рабочую версию. Создайте новую версию.',409)
    if action=='submit':
        require(db.execute('SELECT COUNT(*) FROM stages WHERE tree_version_id=?',(v['id'],)).fetchone()[0]>0,'Добавьте хотя бы один этап.',422)
        summary=str(data.get('summary','')).strip();require(2<=len(summary)<=2000,'Кратко опишите изменения (2–2000 символов).',422)
        db.execute("UPDATE tree_versions SET state='in_review',change_summary=?,submitted_at=? WHERE id=?",(summary,utc_now(),v['id']))
        recipients=[p['fund_manager_id']] if p['fund_manager_id'] else [r[0] for r in db.execute("SELECT id FROM users WHERE role_id=4 AND status='active'")]
        notify(db,p,'review','Проект ожидает проверки',p['name'],recipients)
    elif action=='card':
        card=json.loads(v['card_json']) if v['card_json'] else snapshot(p)
        before=dict(card)
        for k in CARD:
            if k in data: card[k]=str(data[k]).strip() if k!='ugt_level' else integer(data[k],1,9,'УГТ')
        require(all(card[k] for k in ('name','summary','description','field')),'Заполните название, описание и область проекта.',422)
        require(card['status'] in ('active','paused','completed'),'Выберите статус проекта.',422)
        require(all(len(str(card[k]))<=10000 for k in CARD),'Слишком длинное описание.',422)
        changes={k:{'before':before.get(k),'after':card[k]} for k in CARD if before.get(k)!=card[k]}
        db.execute('UPDATE tree_versions SET card_json=? WHERE id=?',(json.dumps(card,ensure_ascii=False),v['id']))
    elif action=='stage-position':
        stage=db.execute('SELECT * FROM stages WHERE public_id=? AND tree_version_id=?',(data.get('stage_id'),v['id'])).fetchone()
        require(stage,'Событие не найдено.',404)
        require(all(isinstance(data.get(k),int) and not isinstance(data.get(k),bool) and 35<=data[k]<=50000 for k in ('map_x','map_y')),'Положение узла выходит за границы карты.',422)
        changes={'stage':{'before':{'map_x':stage['map_x'],'map_y':stage['map_y']},'after':{'map_x':data['map_x'],'map_y':data['map_y']}}}
        db.execute('UPDATE stages SET map_x=?,map_y=? WHERE id=?',(data['map_x'],data['map_y'],stage['id']))
    elif action=='stage-outcome':
        require(user['role_code']=='founder' and p['founder_id']==user['id'],'Итог может подвести только основатель этого проекта.',403)
        stage=db.execute('SELECT * FROM stages WHERE public_id=? AND tree_version_id=?',(data.get('stage_id'),v['id'])).fetchone()
        require(stage,'Событие не найдено.',404)
        outcome=data.get('outcome');note=str(data.get('outcome_note','')).strip()
        require(outcome in ('success','failure','inconclusive'),'Выберите итог события.',422)
        require(2<=len(note)<=10000,'Опишите итог события: от 2 до 10 000 символов.',422)
        changes={'stage':{'before':{k:stage[k] for k in ('outcome','outcome_note','status')},'after':{'outcome':outcome,'outcome_note':note,'status':'completed'}}}
        db.execute("UPDATE stages SET outcome=?,outcome_note=?,outcome_at=?,status='completed',progress=100,completed_at=COALESCE(completed_at,?) WHERE id=?",(outcome,note,utc_now(),utc_now(),stage['id']))
    elif action in ('stages','stage-update','stage-delete'):
        s=db.execute('SELECT * FROM stages WHERE public_id=? AND tree_version_id=?',(data.get('stage_id'),v['id'])).fetchone()
        if action!='stages': require(s,'Этап не найден в текущей версии.',404)
        if s: changes['stage']={'before':{k:s[k] for k in ('title','description','criteria_text','attention_note','status','progress','ugt_level','due_at')}}
        if action=='stage-delete':
            db.execute('UPDATE stages SET parent_stage_id=? WHERE parent_stage_id=?',(s['parent_stage_id'],s['id']));db.execute('DELETE FROM stages WHERE id=?',(s['id'],))
        else:
            title=str(data.get('title','')).strip();status=data.get('status','planned');require(1<=len(title)<=100 and status in ('planned','in_progress','completed'),'Укажите название до 100 символов и статус этапа.',422)
            progress=100 if status=='completed' else integer(data.get('progress',0),0,99,'Готовность этапа')
            require(status!='planned' or progress==0,'У запланированного этапа готовность должна быть 0%.',422)
            ugt=integer(data.get('ugt_level',p['ugt_level']),1,9,'УГТ');due=data.get('due_at') or None
            if due:
                try: date.fromisoformat(due)
                except (ValueError,TypeError): raise Problem(422,'Укажите корректную дату этапа.')
            parent=db.execute('SELECT id,parent_stage_id FROM stages WHERE public_id=? AND tree_version_id=?',(data.get('parent'),v['id'])).fetchone() if data.get('parent') else None
            require(not data.get('parent') or parent,'Предыдущий этап не найден.',422)
            cursor=parent
            while cursor:
                require(not s or cursor['id']!=s['id'],'Связь создаёт цикл. Выберите другой предыдущий этап.',422)
                cursor=db.execute('SELECT id,parent_stage_id FROM stages WHERE id=?',(cursor['parent_stage_id'],)).fetchone()
            owner=db.execute('SELECT id FROM users WHERE public_id=? AND status=\'active\'',(data.get('owner'),)).fetchone() if data.get('owner') else None
            require(not data.get('owner') or owner and (owner['id'] in (p['founder_id'],p['fund_manager_id']) or db.execute('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?',(p['id'],owner['id'])).fetchone()),'Выберите ответственного из команды проекта.',422)
            sid=s['public_id'] if s else public_id('stg');completed=(s['completed_at'] if s else None) or utc_now() if status=='completed' else None
            criteria_text=str(data.get('criteria_text',s['criteria_text'] if s else '')).strip()
            attention_note=str(data.get('attention_note',s['attention_note'] if s else '')).strip()
            require(len(criteria_text)<=4000 and len(attention_note)<=1000,'Сократите критерии или примечание к этапу.',422)
            fields=(parent['id'] if parent else None,title,str(data.get('description','')).strip()[:10000],criteria_text,attention_note,status,progress,ugt,due,owner['id'] if owner else None,completed)
            if s: db.execute('UPDATE stages SET parent_stage_id=?,title=?,description=?,criteria_text=?,attention_note=?,status=?,progress=?,ugt_level=?,due_at=?,owner_id=?,completed_at=? WHERE id=?',(*fields,s['id']))
            else:
                pos=db.execute('SELECT COALESCE(MAX(position),0)+1 FROM stages WHERE tree_version_id=?',(v['id'],)).fetchone()[0]
                db.execute('INSERT INTO stages(public_id,tree_version_id,position,parent_stage_id,title,description,criteria_text,attention_note,status,progress,ugt_level,due_at,owner_id,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(sid,v['id'],pos,*fields))
            data['stage_id']=sid
            changes.setdefault('stage',{})['after']={'title':title,'description':fields[2],'criteria_text':criteria_text,'attention_note':attention_note,'status':status,'progress':progress,'ugt_level':ugt,'due_at':due}
    elif action=='material':
        s=db.execute('SELECT id FROM stages WHERE public_id=? AND tree_version_id=?',(data.get('stage_id'),v['id'])).fetchone();require(s,'Выберите этап.',422)
        title=str(data.get('title','')).strip();require(1<=len(title)<=200,'Укажите название материала до 200 символов.',422)
        try: raw=base64.b64decode(data.get('content',''),validate=True)
        except (ValueError,TypeError): raise Problem(422,'Не удалось прочитать файл.')
        require(0<len(raw)<=500000,'Максимальный размер файла — 500 КБ.',422)
        # Content stored as base64 in SQLite: included in atomic transactions and backups.
        db.execute('INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)',(public_id('doc'),s['id'],title,'base64:'+base64.b64encode(raw).decode(),'application/octet-stream',len(raw),hashlib.sha256(raw).hexdigest(),user['id']))
    elif action=='material-delete':
        e=db.execute('SELECT e.id FROM evidence e JOIN stages s ON s.id=e.stage_id WHERE e.public_id=? AND s.tree_version_id=?',(data.get('material_id'),v['id'])).fetchone();require(e,'Материал не найден.',404);db.execute('DELETE FROM evidence WHERE id=?',(e['id'],))
    else: raise Problem(404,'Действие не найдено.')
    db.execute('UPDATE tree_versions SET revision=revision+1 WHERE id=?',(v['id'],))
    db.execute('UPDATE projects SET updated_at=? WHERE id=?',(utc_now(),p['id']))
    audit(db,user,'tree.'+action,pid,{'version':v['version_number'],'stage_id':data.get('stage_id'),'changes':changes})
    stage_change=changes.get('stage',{})
    if 'status' in changes or stage_change.get('before',{}).get('status')!=stage_change.get('after',{}).get('status'):
        notify(db,p,'draft_status','Изменён статус в рабочей версии',p['name'],[uid for uid in (p['founder_id'],p['fund_manager_id']) if uid and uid!=user['id']])
    return {'ok':True,'stage_id':data.get('stage_id')}

def user_create(db,data):
    role=data.get('role','founder');require(role in ('founder','investor','fund_staff','super_admin'),'Выберите роль.',422)
    name=str(data.get('full_name','')).strip();email=str(data.get('email','')).strip().lower();phone=str(data.get('phone','')).strip();password=str(data.get('password',''))
    require(name and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email),'Укажите имя и корректный email.',422)
    require(not phone and role=='founder' or re.fullmatch(r'\+[1-9]\d{9,14}',phone),'Телефон должен быть в международном формате: +79991234567.',422)
    require(12<=len(password)<=200,'Пароль должен содержать от 12 до 200 символов.',422)
    uid=public_id('usr');db.execute('INSERT INTO users(public_id,role_id,full_name,email,phone,organization,password_hash) VALUES(?,(SELECT id FROM roles WHERE code=?),?,?,?,?,?)',(uid,role,name,email,phone or None,str(data.get('organization','')).strip(),hash_password(password)));return uid

def admin_command(db,user,action,data):
    require(user and user['role_code']=='super_admin')
    if action=='users': result={'user_id':user_create(db,data)}
    elif action=='user-update':
        target=db.execute('SELECT * FROM users WHERE public_id=?',(data.get('user_id'),)).fetchone();require(target,'Пользователь не найден.',404)
        status=data.get('status',target['status']);role=data.get('role',db.execute('SELECT code FROM roles WHERE id=?',(target['role_id'],)).fetchone()[0]);require(status in ('active','blocked','archived') and role in ('investor','founder','fund_staff','super_admin'),'Проверьте роль и статус.',422)
        require(target['id']!=user['id'] or status=='active' and role=='super_admin','Нельзя заблокировать себя или снять свою роль администратора.',422)
        name=str(data.get('full_name',target['full_name'])).strip()
        email=str(data.get('email',target['email'])).strip().lower()
        phone=str(data.get('phone',target['phone'] or '')).strip() or None
        require(name and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email),'Укажите имя и корректный email.',422)
        require(not phone or re.fullmatch(r'\+[1-9]\d{9,14}',phone),'Укажите телефон в международном формате.',422)
        db.execute('UPDATE users SET full_name=?,email=?,phone=?,organization=? WHERE id=?',(name,email,phone,str(data.get('organization',target['organization'] or '')),target['id']))
        db.execute('UPDATE users SET role_id=(SELECT id FROM roles WHERE code=?),status=?,updated_at=? WHERE id=?',(role,status,utc_now(),target['id']))
        if status!=target['status'] or role!=db.execute('SELECT code FROM roles WHERE id=?',(target['role_id'],)).fetchone()[0] or data.get('password'):
            db.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=?',(utc_now(),target['id']))
        if data.get('password'):
            require(12<=len(data['password'])<=200,'Пароль должен содержать 12–200 символов.',422);db.execute('UPDATE users SET password_hash=? WHERE id=?',(hash_password(data['password']),target['id']))
        result={'ok':True}
    elif action=='registration':
        r=db.execute('SELECT * FROM registration_requests WHERE public_id=?',(data.get('request_id'),)).fetchone();require(r and r['status']=='pending','Заявка уже обработана или не найдена.',409)
        approve=data.get('decision')=='approve';require(data.get('decision') in ('approve','reject'),'Выберите решение.',422)
        result={'ok':True}
        if approve:
            existing=db.execute('SELECT 1 FROM users WHERE email=?',(r['email'],)).fetchone()
            require(not existing,'Для этого email уже есть учётная запись.',409)
            password_hash=r['password_hash']
            if not password_hash:
                import secrets
                temporary_password=secrets.token_urlsafe(24)
                password_hash=hash_password(temporary_password)
                result['temporary_password']=temporary_password
            uid=public_id('usr')
            db.execute("INSERT INTO users(public_id,role_id,full_name,email,phone,organization,password_hash,status) VALUES(?,(SELECT id FROM roles WHERE code='founder'),?,?,NULL,?,?,'active')",(uid,r['full_name'],r['email'],r['organization'],password_hash))
            result['user_id']=uid
        db.execute('UPDATE registration_requests SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?',('approved' if approve else 'rejected',user['id'],utc_now(),r['id']))
    elif action=='assign':
        p=db.execute('SELECT * FROM projects WHERE public_id=?',(data.get('project_id'),)).fetchone();manager=db.execute("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=? AND r.code='fund_staff' AND u.status='active'",(data.get('manager_id'),)).fetchone();require(p and (manager or not data.get('manager_id')),'Выберите проект и активного сотрудника фонда.',422)
        db.execute('UPDATE projects SET fund_manager_id=? WHERE id=?',(manager['id'] if manager else None,p['id']));audit(db,user,'project.assigned',p['public_id'],{'manager':data.get('manager_id')});result={'ok':True}
    else: raise Problem(404,'Действие не найдено.')
    entity_type='project' if action=='assign' else 'user'
    entity_id=data.get('project_id') if action=='assign' else data.get('user_id') or data.get('request_id') or result.get('user_id')
    db.execute("INSERT INTO audit_log(public_id,actor_id,action,entity_type,entity_public_id) VALUES(?,?,?,?,?)",(public_id('aud'),user['id'],'admin.'+action,entity_type,entity_id))
    return result
