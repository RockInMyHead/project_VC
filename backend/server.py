from __future__ import annotations

import json
from contextlib import closing
import base64
import hashlib
import ipaddress
import workflow
from sms import send_code, DeliveryError
import os
import re
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from db import DB_PATH, connect, hash_password, hash_token, init_database, public_id, utc_now, verify_password, transaction

ROOT = Path(__file__).resolve().parents[1]
UPLOAD_ROOT = DB_PATH.parent / 'uploads'
PROXY_PEER_RANGES=tuple(ipaddress.ip_network(net) for net in ('127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','::1/128','fc00::/7'))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or public_id("project")


def normalize_project_code(value: str) -> str:
    value = re.sub(r"\s+", "-", str(value).strip().upper())
    return "".join(char for char in value if char.isalnum() or char in "_-")[:24]


def audit_entries(db: sqlite3.Connection, query: str) -> dict:
    params = parse_qs(query)
    value = lambda key: params.get(key, [''])[0].strip()
    clauses = []
    args = []
    for key, column in [('action', 'a.action'), ('actor', 'u.full_name')]:
        term = value(key)[:100]
        if term:
            clauses.append(f"{column} LIKE ? ESCAPE '\\'")
            args.append('%' + term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%')
    entity = value('entity')
    if entity:
        if entity not in ('project', 'user', 'session', 'message'):
            raise ValueError('Некорректный тип объекта аудита.')
        clauses.append('a.entity_type=?')
        args.append(entity)
    for key, operator in [('from', '>='), ('to', '<=')]:
        day = value(key)
        if day:
            try:
                datetime.strptime(day, '%Y-%m-%d')
            except ValueError:
                raise ValueError('Укажите дату в формате ГГГГ-ММ-ДД.')
            clauses.append(f'date(a.created_at){operator}?')
            args.append(day)
    before = value('before')
    if before:
        if not before.isdecimal() or len(before) > 18 or int(before) < 1:
            raise ValueError('Некорректный курсор аудита.')
        clauses.append('a.id<?')
        args.append(int(before))
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    rows = db.execute('''SELECT a.id,a.public_id,a.action,a.entity_type,a.entity_public_id,
        a.ip_address,a.metadata_json,a.created_at,u.full_name actor_name
        FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id''' + where +
        ' ORDER BY a.id DESC LIMIT 51', args).fetchall()
    items = [dict(row) for row in rows[:50]]
    next_cursor = items[-1]['id'] if len(rows) > 50 else None
    for item in items:
        item.pop('id')
    return {'items': items, 'next_cursor': next_cursor}


def admin_activity(db: sqlite3.Connection) -> dict:
    today = datetime.now(timezone.utc).date()
    dates = [(today - timedelta(days=offset)).isoformat() for offset in range(6, -1, -1)]
    start = dates[0]
    series = {day: {'date': day, 'active_users': 0, 'registrations': 0, 'actions': 0} for day in dates}
    queries = {
        'active_users': "SELECT substr(created_at,1,10) day, COUNT(DISTINCT actor_id) total FROM audit_log WHERE actor_id IS NOT NULL AND created_at>=? GROUP BY day",
        'registrations': "SELECT substr(created_at,1,10) day, COUNT(*) total FROM users WHERE created_at>=? GROUP BY day",
        'actions': "SELECT substr(created_at,1,10) day, COUNT(*) total FROM audit_log WHERE created_at>=? GROUP BY day",
    }
    for metric, query in queries.items():
        for row in db.execute(query, (start,)):
            if row['day'] in series:
                series[row['day']][metric] = row['total']
    return {'timezone': 'UTC', 'days': list(series.values())}


def create_registration_request(db: sqlite3.Connection, data: dict) -> str | None:
    required = ("full_name", "email", "organization")
    if any(not isinstance(data.get(k),str) or len(data[k])>500 for k in required): return None
    if any(not str(data.get(key, " ")).strip() for key in required) or data.get("requested_role", "founder") != "founder":
        return None
    email=str(data['email']).strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): return None
    password=str(data.get('password',''))
    if not 12<=len(password)<=200: return None
    existing=db.execute("SELECT public_id FROM registration_requests WHERE email=? AND status='pending'",(email,)).fetchone()
    if existing: return existing[0]
    if db.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone(): return None
    request_id = public_id("reg")
    db.execute(
        "INSERT INTO registration_requests(public_id,requested_role,full_name,email,organization,password_hash) VALUES(?,?,?,?,?,?)",
        (request_id, "founder", data["full_name"].strip(), email, data["organization"].strip(), hash_password(password)),
    )
    return request_id


def create_founder_project(db: sqlite3.Connection, user: sqlite3.Row, data: dict) -> dict | None:
    required = ("code", "name", "summary", "description", "field")
    if any(data.get(k) is None or not isinstance(data.get(k),str) or len(data[k])>10000 for k in required): return None
    if any(not str(data.get(key, " ")).strip() for key in required):
        return None
    if user['role_code']=='founder':
        founder_id=user['id'];manager_id=None
    elif user['role_code']=='fund_staff':
        founder=db.execute("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=? AND u.status='active' AND r.code='founder'",(data.get('founder_id'),)).fetchone()
        if not founder: return None
        founder_id=founder['id'];manager_id=user['id']
    else: return None
    try:
        ugt_level = int(data.get("ugt_level", 1))
    except (TypeError, ValueError):
        return None
    if not 1 <= ugt_level <= 9:
        return None

    code = normalize_project_code(data["code"])
    if len(code) < 2:
        return None
    project_id = public_id("prj")
    version_id = public_id("tree")
    slug_base = slugify(str(data["name"]))[:48]
    slug = slug_base
    index = 2
    while db.execute("SELECT 1 FROM projects WHERE slug=?", (slug,)).fetchone():
        slug = f"{slug_base}-{index}"
        index += 1
    if db.execute("SELECT 1 FROM projects WHERE code=?", (code,)).fetchone():
        return None
    raw_stages = data.get("stages") or []
    if isinstance(raw_stages, str):
        raw_stages = [line.strip() for line in raw_stages.splitlines() if line.strip()]
    if not isinstance(raw_stages, list) or len(raw_stages) > 12:
        return None
    known_ids = set()
    for stage in raw_stages:
        if not isinstance(stage, (str, dict)):
            return None
        node = stage if isinstance(stage, dict) else {"title": stage}
        if not str(node.get("title", "")).strip() or node.get("status", "planned") not in ("planned", "in_progress", "completed"):
            return None
        if not isinstance(node.get("parent"),(str,int,type(None))): return None
        if node.get("parent") is not None and node["parent"] not in known_ids:
            return None
        try:
            stage_ugt = int(node.get("ugt_level", ugt_level))
        except (TypeError, ValueError):
            return None
        if not 1 <= stage_ugt <= 9:
            return None
        choices=node.get('choices',[])
        if not isinstance(choices,list) or len(choices)>12 or any(not isinstance(choice,str) or not 1<=len(choice.strip())<=200 for choice in choices): return None
        selected_choice=node.get('selected_choice')
        if selected_choice is not None and (not isinstance(selected_choice,int) or isinstance(selected_choice,bool) or not 0<=selected_choice<len(choices)): return None
        if isinstance(stage, dict):
            if not isinstance(node.get('id'),(str,int)) or not isinstance(node.get('parent'),(str,int,type(None))): return None
            if node.get("id") is None or node["id"] in known_ids:
                return None
            known_ids.add(node["id"])

    db.execute(
        """
        INSERT INTO projects(public_id,code,slug,name,summary,description,field,region,status,ugt_level,founder_id,fund_manager_id)
        VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?)
        """,
        (
            project_id,
            code,
            slug,
            str(data["name"]).strip(),
            str(data["summary"]).strip(),
            str(data["description"]).strip(),
            str(data["field"]).strip(),
            str(data.get("region", "")).strip() or None,
            ugt_level,
            founder_id,manager_id,
        ),
    )
    project_row_id = db.execute("SELECT id FROM projects WHERE public_id=?", (project_id,)).fetchone()[0]
    db.execute(
        "INSERT INTO tree_versions(public_id,project_id,version_number,state,change_summary,created_by) VALUES(?,?,1,'draft',?,?)",
        (version_id, project_row_id, "Первичная структура дерева прогресса", user["id"]),
    )
    tree_id = db.execute("SELECT id FROM tree_versions WHERE public_id=?", (version_id,)).fetchone()[0]
    stages = raw_stages or ["Гипотеза и научная база", "Прототип и проверка", "Подготовка к публикации"]
    if any(not isinstance(stage, (str, dict)) for stage in stages):
        return None
    stage_ids = {}
    stage_public_ids = {}
    for position, stage in enumerate(stages, start=1):
        node = stage if isinstance(stage, dict) else {"title": stage}
        title = str(node.get("title", "")).strip()[:100]
        if not title:
            return None
        status = node.get("status", "in_progress" if position == 1 else "planned")
        if status not in ("planned", "in_progress", "completed"):
            return None
        parent = node.get("parent")
        if parent is not None and parent not in stage_ids:
            return None
        try:
            stage_ugt = int(node.get("ugt_level", min(ugt_level, position)))
        except (TypeError, ValueError):
            return None
        if not 1 <= stage_ugt <= 9:
            return None
        progress = 100 if status == "completed" else 0
        stage_public_id = public_id("stg")
        db.execute(
            """
            INSERT INTO stages(public_id,tree_version_id,parent_stage_id,position,branch_code,title,description,status,progress,ugt_level,choice_options_json,selected_choice)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (stage_public_id, tree_id, stage_ids.get(parent), position, "branch" if parent is not None else "main", title, str(node.get("description", "")).strip()[:2000], status, progress, stage_ugt,json.dumps([choice.strip() for choice in node.get('choices',[])],ensure_ascii=False),node.get('selected_choice')),
        )
        if isinstance(stage, dict):
            stage_ids[stage.get("id")] = db.execute("SELECT id FROM stages WHERE public_id=?", (stage_public_id,)).fetchone()[0]
            stage_public_ids[str(stage.get('id'))]=stage_public_id
    return {"public_id": project_id, "code": code, "slug": slug, "tree_version": version_id, "stage_count": len(stages), "status": "draft", "stage_ids":stage_public_ids}


class ApiHandler(SimpleHTTPRequestHandler):
    server_version = "Platform/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _client_ip(self):
        peer=self.client_address[0]
        if os.environ.get('BOKOBOK_TRUST_PROXY')!='1': return peer
        try:
            trusted_peer=ipaddress.ip_address(peer)
            if not any(trusted_peer in network for network in PROXY_PEER_RANGES): return peer
            forwarded=ipaddress.ip_address(self.headers.get('X-Real-IP',''))
            return str(forwarded)
        except ValueError:
            return peer

    def end_headers(self):
        if urlparse(self.path).path in ('/', '/index.html', '/admin.html'):
            self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()

    def _json(self, status: int, payload: dict | list):
        if isinstance(payload, dict) and payload.get("error") and not payload.get("message"):
            messages = {
                "unauthorized": "Сессия завершена. Пожалуйста, войдите снова.",
                "forbidden": "У вашей учётной записи нет доступа к этому действию.",
                "not_found": "Запрошенная страница не найдена.",
                "project_not_found": "Проект не найден или больше недоступен.",
                "invalid_request": "Не удалось обработать отправленные данные.",
                "invalid_credentials": "Неверный email, телефон или пароль.",
                "otp_expired": "Срок действия кода истёк. Войдите ещё раз, чтобы получить новый код.",
                "invalid_otp": "Код введён неверно. Проверьте цифры и попробуйте снова.",
                "validation_failed": "Проверьте заполненные поля и попробуйте снова.",
            }
            payload["message"] = messages.get(payload["error"], "Не удалось выполнить действие. Попробуйте ещё раз.")
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ValueError("Payload too large")
        if length < 0: raise ValueError("Invalid length")
        return json.loads(self.rfile.read(length) or b"{}")

    def _bearer_user(self, db: sqlite3.Connection):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        token_hash = hash_token(auth[7:])
        return db.execute("""
          SELECT u.*,r.code AS role_code FROM auth_sessions s
          JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
          WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status='active'
        """, (token_hash, utc_now())).fetchone()

    def _upload_material(self, project_id):
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: length=0
        if not 0<length<=50_000_000: return self._json(413,{'error':'file_too_large','message':'Размер одного файла не должен превышать 50 МБ.'})
        stage_id=self.headers.get('X-Stage-Id','')
        title=Path(unquote(self.headers.get('X-File-Name',''))).name.strip()
        mime_type=self.headers.get('Content-Type','application/octet-stream').split(';',1)[0].strip().lower()
        if not 1<=len(title)<=200 or not re.fullmatch(r'[a-z0-9.+-]+/[a-z0-9.+-]+',mime_type):
            return self._json(422,{'error':'validation_failed','message':'Проверьте название и тип файла.'})
        try:
            with closing(connect()) as db:
                user=self._bearer_user(db)
                workflow.require(user,'Войдите в систему.',401)
                project=workflow.get_project(db,user,project_id)
                workflow.require(workflow.editable(db,user,project),'Нет доступа к загрузке файлов.',403)
                tree=workflow.version(db,project,True)
                workflow.require(tree and tree['state']=='draft','Изменять можно только рабочую версию.',409)
                stage=db.execute('SELECT id FROM stages WHERE public_id=? AND tree_version_id=?',(stage_id,tree['id'])).fetchone()
                workflow.require(stage,'Этап не найден.',404)
                UPLOAD_ROOT.mkdir(parents=True,exist_ok=True)
                key=secrets.token_hex(24)
                target=UPLOAD_ROOT / key
                digest=hashlib.sha256();remaining=length
                try:
                    with target.open('xb') as output:
                        while remaining:
                            chunk=self.rfile.read(min(1024*1024,remaining))
                            if not chunk: raise ValueError('Загрузка прервана.')
                            output.write(chunk);digest.update(chunk);remaining-=len(chunk)
                    with transaction(db):
                        existing=db.execute('SELECT public_id FROM evidence WHERE stage_id=? AND title=? AND checksum_sha256=?',(stage['id'],title,digest.hexdigest())).fetchone()
                        if existing:
                            target.unlink(missing_ok=True)
                            return self._json(200,{'material_id':existing['public_id']})
                        material_id=public_id('doc')
                        db.execute('INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)',(material_id,stage['id'],title,'file:'+key,mime_type,length,digest.hexdigest(),user['id']))
                        workflow.audit(db,user,'tree.material',project_id,{'stage_id':stage_id,'title':title,'byte_size':length})
                    return self._json(201,{'material_id':material_id})
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
        except workflow.Problem as error: return self._json(error.status,{'error':'request_failed','message':error.message})
        except (OSError,ValueError): return self._json(500,{'error':'upload_failed','message':'Не удалось сохранить файл. Попробуйте снова.'})

    def _upload_avatar(self):
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: length=0
        if not 0<length<=2_000_000:
            return self._json(413,{'error':'file_too_large','message':'Фото должно быть не больше 2 МБ.'})
        mime_type=self.headers.get('Content-Type','').split(';',1)[0].strip().lower()
        signatures={
            'image/jpeg':lambda value:value.startswith(b'\xff\xd8\xff'),
            'image/png':lambda value:value.startswith(b'\x89PNG\r\n\x1a\n'),
            'image/webp':lambda value:value.startswith(b'RIFF') and value[8:12]==b'WEBP',
        }
        if mime_type not in signatures:
            return self._json(422,{'error':'invalid_image','message':'Выберите фото в формате JPG, PNG или WebP.'})
        with closing(connect()) as db:
            user=self._bearer_user(db)
            if not user: return self._json(401,{'error':'unauthorized'})
            image_data=self.rfile.read(length)
            if len(image_data)!=length or not signatures[mime_type](image_data):
                return self._json(422,{'error':'invalid_image','message':'Не удалось прочитать фото. Выберите другой файл.'})
            with transaction(db):
                db.execute('''INSERT INTO user_avatars(user_id,mime_type,image_data,updated_at) VALUES(?,?,?,?)
                    ON CONFLICT(user_id) DO UPDATE SET mime_type=excluded.mime_type,image_data=excluded.image_data,updated_at=excluded.updated_at''',
                    (user['id'],mime_type,image_data,utc_now()))
                self._audit(db,user['id'],'profile.avatar_updated','user',user['public_id'],{})
        return self._json(200,{'ok':True})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            with closing(connect()) as db:
                ok = db.execute("PRAGMA quick_check").fetchone()[0]
            return self._json(200, {"status": "ok", "database": ok})
        if path == '/api/profile/avatar':
            with closing(connect()) as db:
                user=self._bearer_user(db)
                if not user: return self._json(401,{'error':'unauthorized'})
                avatar=db.execute('SELECT mime_type,image_data FROM user_avatars WHERE user_id=?',(user['id'],)).fetchone()
                if not avatar: return self._json(404,{'error':'not_found','message':'Фото ещё не загружено.'})
                image_data=avatar['image_data']
            self.send_response(200)
            self.send_header('Content-Type',avatar['mime_type'])
            self.send_header('Content-Length',str(len(image_data)))
            self.send_header('Cache-Control','private, no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers()
            self.wfile.write(image_data)
            return
        if path == '/api/founders':
            with closing(connect()) as db:
                user=self._bearer_user(db)
                if not user: return self._json(401,{'error':'unauthorized'})
                if user['role_code'] not in ('fund_staff','super_admin'): return self._json(403,{'error':'forbidden'})
                rows=db.execute("SELECT u.public_id,u.full_name,u.organization FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='founder' AND u.status='active' ORDER BY u.full_name COLLATE NOCASE").fetchall()
                return self._json(200,{'items':[dict(row) for row in rows]})
        if path == "/api/projects" or path.startswith("/api/projects/") or path.startswith("/api/notifications") or path == '/api/changes':
            with closing(connect()) as db:
                user = self._bearer_user(db)
                try:
                    workflow.require(user, 'Войдите в систему.', 401)
                    if path == '/api/projects': return self._json(200, workflow.project_list(db,user))
                    if path == '/api/changes': return self._json(200, workflow.founder_changes(db,user,urlparse(self.path).query))
                    if path == '/api/notifications':
                        return self._json(200, {'items':[dict(r) for r in db.execute('SELECT public_id,title,body,entity_public_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 200',(user['id'],))]})
                    parts=path.strip('/').split('/')
                    if len(parts)==4 and parts[3]=='team-candidates':
                        project=workflow.get_project(db,user,parts[2])
                        workflow.require(workflow.owner_or_manager(user,project))
                        rows=db.execute("""SELECT u.public_id,u.full_name,u.organization FROM users u JOIN roles r ON r.id=u.role_id
                          WHERE r.code='founder' AND u.status='active' AND u.id!=? AND NOT EXISTS
                          (SELECT 1 FROM project_members pm WHERE pm.project_id=? AND pm.user_id=u.id)
                          ORDER BY u.full_name COLLATE NOCASE""",(project['founder_id'],project['id'])).fetchall()
                        return self._json(200,{'items':[dict(row) for row in rows]})
                    if len(parts)==5 and parts[3]=='materials':
                        project=workflow.get_project(db,user,parts[2]);v=workflow.version(db,project,workflow.private_visible(db,user,project))
                        material=db.execute('SELECT e.* FROM evidence e JOIN stages s ON s.id=e.stage_id WHERE e.public_id=? AND s.tree_version_id=?',(parts[4],v['id'])).fetchone()
                        workflow.require(material and material['storage_key'].startswith('base64:'),'Материал недоступен.',404)
                        return self._json(200,{'title':material['title'],'content':material['storage_key'][7:]})
                    if len(parts)==6 and parts[3]=='materials' and parts[5]=='download':
                        project=workflow.get_project(db,user,parts[2]);v=workflow.version(db,project,workflow.private_visible(db,user,project))
                        material=db.execute('SELECT e.* FROM evidence e JOIN stages s ON s.id=e.stage_id WHERE e.public_id=? AND s.tree_version_id=?',(parts[4],v['id'])).fetchone()
                        workflow.require(material,'Материал недоступен.',404)
                        if material['storage_key'].startswith('file:'):
                            target=UPLOAD_ROOT / Path(material['storage_key'][5:]).name
                            workflow.require(target.is_file(),'Файл не найден на сервере.',404)
                            size=target.stat().st_size
                            body=None
                        else:
                            body=base64.b64decode(material['storage_key'][7:])
                            size=len(body)
                        self.send_response(200)
                        self.send_header('Content-Type',material['mime_type'])
                        self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(material['title']))
                        self.send_header('Content-Length',str(size))
                        self.end_headers()
                        if body is not None: self.wfile.write(body)
                        else:
                            with target.open('rb') as stream:
                                while chunk:=stream.read(1024*1024): self.wfile.write(chunk)
                        return
                    if len(parts)==3: return self._json(200,workflow.project_detail(db,user,parts[2]))
                    raise workflow.Problem(404,'Страница не найдена.')
                except workflow.Problem as e: return self._json(e.status,{'error':'request_failed','message':e.message})
        if path == "/api/messages/contacts":
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                rows = db.execute("""
                    SELECT u.public_id,u.full_name,u.organization,r.code AS role,
                      (SELECT m.body FROM direct_messages m WHERE
                        (m.sender_id=? AND m.recipient_id=u.id) OR
                        (m.sender_id=u.id AND m.recipient_id=?)
                        ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
                      (SELECT MAX(m.created_at) FROM direct_messages m WHERE
                        (m.sender_id=? AND m.recipient_id=u.id) OR
                        (m.sender_id=u.id AND m.recipient_id=?)) AS last_message_at,
                      (SELECT COUNT(*) FROM direct_messages m WHERE m.sender_id=u.id AND m.recipient_id=? AND m.read_at IS NULL) AS unread_count
                    FROM users u JOIN roles r ON r.id=u.role_id
                    WHERE u.id!=? AND u.status='active' AND r.code!='super_admin'
                    ORDER BY last_message_at DESC,u.full_name COLLATE NOCASE
                """, (user["id"], user["id"], user["id"], user["id"], user["id"], user["id"])).fetchall()
            return self._json(200, {"items": [dict(row) for row in rows]})
        if path.startswith("/api/messages/"):
            recipient_id = path.rsplit("/", 1)[1]
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                contact = db.execute("SELECT id,public_id,full_name,organization FROM users WHERE public_id=? AND id!=? AND status='active'", (recipient_id,user["id"])).fetchone()
                if not contact:
                    return self._json(404, {"error": "not_found"})
                db.execute("UPDATE direct_messages SET read_at=? WHERE sender_id=? AND recipient_id=? AND read_at IS NULL", (utc_now(),contact["id"],user["id"]))
                rows = db.execute("""
                    SELECT public_id,sender_id,body,created_at,read_at FROM direct_messages
                    WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)
                    ORDER BY created_at DESC,id DESC LIMIT 500
                """, (user["id"],contact["id"],contact["id"],user["id"])).fetchall()
            return self._json(200, {"contact": {key: contact[key] for key in ("public_id","full_name","organization")}, "items": [{"public_id": row["public_id"], "own": row["sender_id"] == user["id"], "body": row["body"], "created_at": row["created_at"], "read_at": row["read_at"]} for row in reversed(rows)]})
        if path == "/api/auth/me":
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user:
                    return self._json(401, {"error": "unauthorized", "message": "Сессия завершена. Пожалуйста, войдите снова."})
                return self._json(200, {"user": {"public_id": user["public_id"], "full_name": user["full_name"], "email": user["email"], "organization": user["organization"], "role": user["role_code"]}})
        if path == "/api/profile":
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user: return self._json(401, {"error":"unauthorized", "message":"Сессия завершена. Пожалуйста, войдите снова."})
                token_hash = hash_token(self.headers.get('Authorization','')[7:])
                sessions = db.execute("""SELECT public_id,ip_address,user_agent,created_at,expires_at,token_hash
                    FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>?
                    ORDER BY created_at DESC""", (user['id'],utc_now())).fetchall()
                return self._json(200, {"user": {key:user[key] for key in ('public_id','full_name','email','phone','organization','status','created_at','last_login_at')} | {'role':user['role_code']},
                    "sessions": [{"public_id":row['public_id'],"ip_address":row['ip_address'],"user_agent":row['user_agent'],"created_at":row['created_at'],"expires_at":row['expires_at'],"current":row['token_hash']==token_hash} for row in sessions]})
        if path.startswith("/api/admin/"):
            with closing(connect()) as db:
                admin = self._bearer_user(db)
                if not admin or admin["role_code"] != "super_admin":
                    return self._json(403, {"error": "forbidden", "message": "У вашей учётной записи нет доступа к этому разделу."})
                if path == "/api/admin/overview":
                    counts = {
                        "users": db.execute("SELECT COUNT(*) FROM users WHERE status!='archived'").fetchone()[0],
                        "investors": db.execute("SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='investor' AND u.status='active'").fetchone()[0],
                        "projects": db.execute("SELECT COUNT(*) FROM projects WHERE status IN ('active','draft','paused')").fetchone()[0],
                        "reviews": db.execute("SELECT COUNT(*) FROM tree_versions WHERE state='in_review'").fetchone()[0],
                        "pending_registrations": db.execute("SELECT COUNT(*) FROM registration_requests WHERE status='pending'").fetchone()[0],
                        "audit_today": db.execute("SELECT COUNT(*) FROM audit_log WHERE julianday(created_at) >= julianday('now','-1 day')").fetchone()[0],
                    }
                    return self._json(200, counts)
                if path == "/api/admin/activity":
                    return self._json(200, admin_activity(db))
                if path == "/api/admin/users":
                    rows = db.execute("SELECT u.public_id,u.full_name,u.email,u.phone,u.organization,u.status,u.created_at,u.last_login_at,r.code role_code,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at DESC").fetchall()
                    items=[]
                    for row in rows:
                        item=dict(row)
                        item['relationships']=[dict(p) for p in db.execute("SELECT p.name,CASE WHEN p.founder_id=u.id THEN 'Основатель' ELSE 'Сотрудник фонда' END relationship FROM projects p JOIN users u ON u.public_id=? WHERE p.founder_id=u.id OR p.fund_manager_id=u.id",(row['public_id'],))]
                        items.append(item)
                    return self._json(200,{'items':items})
                if path == "/api/admin/registrations":
                    rows = db.execute("SELECT public_id,requested_role,full_name,email,organization,status,created_at FROM registration_requests ORDER BY created_at DESC").fetchall()
                    return self._json(200,{"items":[dict(row) for row in rows]})
                if path == "/api/admin/audit":
                    try:
                        return self._json(200,audit_entries(db,urlparse(self.path).query))
                    except ValueError as error:
                        return self._json(422,{"error":"invalid_filter","message":str(error)})
                return self._json(404,{"error":"not_found"})
        # Only public application assets are served. Never expose source, DB or credentials.
        from urllib.parse import unquote
        clean = unquote(path)
        allowed = {'/','/index.html','/admin.html','/favicon.ico'}
        if clean not in allowed and not (clean.count('/')==1 and clean.endswith(('.js','.css')) and (ROOT/clean[1:]).is_file()):
            return self._json(404, {'error':'not_found'})
        return super().do_GET()

    def do_HEAD(self):
        path=urlparse(self.path).path
        if path not in ('/','/index.html','/admin.html','/favicon.ico') and not (path.count('/')==1 and path.endswith(('.js','.css'))):
            self.send_error(404);return
        super().do_HEAD()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/profile/avatar': return self._upload_avatar()
        upload_parts=path.strip('/').split('/')
        if len(upload_parts)==5 and upload_parts[:2]==['api','projects'] and upload_parts[3:]==['materials','upload']:
            return self._upload_material(upload_parts[2])
        try:
            data = self._body()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": "invalid_request"})
        if not isinstance(data,dict): return self._json(422,{'error':'validation_failed'})
        scalar_keys=('identity','password','current_password','new_password','challenge_id','code','email','full_name','organization','phone','role','status','user_id','project_id','founder_id','manager_id','member_role','request_id','stage_id','parent','owner','notification_id','recipient_id','question_id','material_id','title','body','description','criteria_text','attention_note','outcome','outcome_note','name','summary','field','region','due_at','request_key','decision','comment','content')
        if any(k in data and data[k] is not None and not isinstance(data[k],str) for k in scalar_keys):
            return self._json(422,{'error':'validation_failed'})
        if path in ('/api/profile','/api/profile/password','/api/profile/sessions/revoke-other'):
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user: return self._json(401,{'error':'unauthorized','message':'Сессия завершена. Пожалуйста, войдите снова.'})
                token_hash = hash_token(self.headers.get('Authorization','')[7:])
                if path == '/api/profile':
                    name = data.get('full_name')
                    organization = data.get('organization','')
                    if not isinstance(name,str) or not isinstance(organization,str):
                        return self._json(422,{'error':'validation_failed','message':'Проверьте имя и организацию.'})
                    name = name.strip()
                    organization = organization.strip()
                    if not 2<=len(name)<=120 or len(organization)>160:
                        return self._json(422,{'error':'validation_failed','message':'Укажите имя от 2 до 120 символов и организацию не длиннее 160 символов.'})
                    with transaction(db):
                        db.execute('UPDATE users SET full_name=?,organization=?,updated_at=? WHERE id=?',(name,organization,utc_now(),user['id']))
                        self._audit(db,user['id'],'profile.updated','user',user['public_id'],{})
                    return self._json(200,{'ok':True,'full_name':name,'organization':organization})
                if path == '/api/profile/password':
                    current = str(data.get('current_password',''))
                    new = str(data.get('new_password',''))
                    if not verify_password(current,user['password_hash']):
                        return self._json(403,{'error':'invalid_password','message':'Текущий пароль введён неверно.'})
                    if not 12<=len(new)<=200 or new==current:
                        return self._json(422,{'error':'validation_failed','message':'Новый пароль должен отличаться от текущего и содержать 12–200 символов.'})
                    with transaction(db):
                        db.execute('UPDATE users SET password_hash=?,updated_at=? WHERE id=?',(hash_password(new),utc_now(),user['id']))
                        db.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND token_hash!=? AND revoked_at IS NULL',(utc_now(),user['id'],token_hash))
                        self._audit(db,user['id'],'profile.password_changed','user',user['public_id'],{})
                    return self._json(200,{'ok':True})
                with transaction(db):
                    result=db.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND token_hash!=? AND revoked_at IS NULL',(utc_now(),user['id'],token_hash))
                    self._audit(db,user['id'],'profile.sessions_revoked','user',user['public_id'],{'count':result.rowcount})
                return self._json(200,{'ok':True,'revoked':result.rowcount})
        parts=path.strip('/').split('/')
        if path.startswith('/api/admin/') or len(parts)==4 and parts[:2]==['api','projects'] or path=='/api/notifications/read':
            with closing(connect()) as db:
                user=self._bearer_user(db)
                try:
                    workflow.require(user,'Войдите в систему.',401)
                    with transaction(db):
                        key=str(data.pop('request_key',''))[:100]
                        fingerprint=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
                        receipt=db.execute('SELECT * FROM request_receipts WHERE user_id=? AND request_key=?',(user['id'],key)).fetchone() if key else None
                        if receipt:
                            workflow.require(receipt['path']==path and receipt['fingerprint']==fingerprint,'Этот запрос уже использован с другими данными.',409)
                            return self._json(200,json.loads(receipt['response_json']))
                        if path.startswith('/api/admin/'): result=workflow.admin_command(db,user,parts[-1],data)
                        elif path=='/api/notifications/read':
                            db.execute('UPDATE notifications SET read_at=? WHERE user_id=? AND (public_id=? OR ?)',(utc_now(),user['id'],data.get('notification_id'),bool(data.get('all'))));result={'ok':True}
                        else: result=workflow.project_command(db,user,parts[2],parts[3],data)
                        if key and 'temporary_password' not in result: db.execute('INSERT INTO request_receipts(user_id,request_key,path,fingerprint,response_json) VALUES(?,?,?,?,?)',(user['id'],key,path,fingerprint,json.dumps(result)))
                    return self._json(201 if parts[-1] in ('stages','users','material','questions') else 200,result)
                except workflow.Problem as e: return self._json(e.status,{'error':'request_failed','message':e.message})
                except sqlite3.IntegrityError: return self._json(409,{'error':'conflict','message':'Эти данные уже используются. Проверьте email, телефон и код проекта.'})
        if path == "/api/auth/login":
            with closing(connect()) as db:
                cutoff=(datetime.now(timezone.utc)-timedelta(minutes=15)).isoformat(timespec='milliseconds').replace('+00:00','Z')
                attempts=db.execute("SELECT COUNT(*) FROM audit_log WHERE action IN ('auth.login_failed','auth.password_verified') AND ip_address=? AND created_at>?",(self._client_ip(),cutoff)).fetchone()[0]
                if attempts>=20: return self._json(429,{'error':'rate_limit','message':'Слишком много попыток входа. Попробуйте через 15 минут.'})
                user = db.execute("SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE (u.email=? OR u.phone=?) AND u.status='active'", (data.get("identity", ""), data.get("identity", ""))).fetchone()
                if not user or not verify_password(str(data.get("password", "")), user["password_hash"]):
                    self._audit(db, None, "auth.login_failed", "user", None, {"identity": data.get("identity", "")})
                    return self._json(401, {"error": "invalid_credentials", "message": "Неверный email, телефон или пароль."})
                local_host = os.environ.get("BOKOBOK_HOST", "127.0.0.1") in ("127.0.0.1", "localhost", "::1")
                password_only = os.environ.get("BOKOBOK_DISABLE_SMS_2FA", "1" if local_host else "0") == "1"
                if not user['phone'] or password_only:
                    with transaction(db):
                        raw_token = secrets.token_urlsafe(32)
                        session_id = public_id("ses")
                        session_expires = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                        db.execute("INSERT INTO auth_sessions(public_id,user_id,token_hash,ip_address,user_agent,expires_at) VALUES(?,?,?,?,?,?)", (session_id, user["id"], hash_token(raw_token), self._client_ip(), self.headers.get("User-Agent", ""), session_expires))
                        db.execute("UPDATE users SET last_login_at=? WHERE id=?", (utc_now(), user["id"]))
                        self._audit(db, user["id"], "auth.login_success", "session", session_id, {"method": "password"})
                    return self._json(200, {"token": raw_token, "expires_at": session_expires, "user": {"public_id": user["public_id"], "full_name": user["full_name"], "role": user["role_code"]}})
                challenge = public_id("otp")
                code = f"{secrets.randbelow(1_000_000):06d}"
                expires = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(timespec="milliseconds").replace("+00:00","Z")
                db.execute('UPDATE otp_challenges SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL',(utc_now(),user['id']))
                db.execute("INSERT INTO otp_challenges(public_id,user_id,purpose,code_hash,expires_at) VALUES(?,?,'login',?,?)", (challenge,user["id"],hash_token(code),expires))
                self._audit(db,user["id"],"auth.password_verified","user",user["public_id"],{})
            try:
                send_code(user['phone'],code,user['public_id'])
            except DeliveryError as error:
                with closing(connect()) as db:
                    db.execute('UPDATE otp_challenges SET consumed_at=? WHERE public_id=?',(utc_now(),challenge))
                return self._json(503,{'error':'sms_unavailable','message':str(error)})
            return self._json(200, {"challenge_id": challenge, "expires_in": 300})
        if path == "/api/auth/verify-otp":
            with closing(connect()) as db:
                with transaction(db):
                    challenge = db.execute("SELECT * FROM otp_challenges WHERE public_id=? AND consumed_at IS NULL", (data.get("challenge_id"),)).fetchone()
                    if not challenge or challenge["expires_at"] <= utc_now() or challenge["attempts_left"] <= 0:
                        return self._json(401, {"error": "otp_expired", "message": "Срок действия кода истёк. Войдите ещё раз, чтобы получить новый код."})
                    active=db.execute("SELECT 1 FROM users WHERE id=? AND status='active'",(challenge['user_id'],)).fetchone()
                    if not active: return self._json(401,{'error':'invalid_credentials'})
                    if not secrets.compare_digest(challenge["code_hash"], hash_token(str(data.get("code", "")))):
                        db.execute("UPDATE otp_challenges SET attempts_left=attempts_left-1 WHERE id=?", (challenge["id"],))
                        self._audit(db,challenge['user_id'],'auth.otp_failed','user',None,{})
                        return self._json(401, {"error": "invalid_otp", "message": "Код введён неверно. Проверьте цифры и попробуйте снова.", "attempts_left": challenge["attempts_left"]-1})
                    raw_token = secrets.token_urlsafe(32)
                    session_id = public_id("ses")
                    expires = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(timespec="milliseconds").replace("+00:00","Z")
                    db.execute("UPDATE otp_challenges SET consumed_at=? WHERE id=?", (utc_now(),challenge["id"]))
                    db.execute("INSERT INTO auth_sessions(public_id,user_id,token_hash,ip_address,user_agent,expires_at) VALUES(?,?,?,?,?,?)",(session_id,challenge["user_id"],hash_token(raw_token),self._client_ip(),self.headers.get("User-Agent",""),expires))
                    user = db.execute("SELECT u.public_id,u.full_name,r.code role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?",(challenge["user_id"],)).fetchone()
                    db.execute('UPDATE users SET last_login_at=? WHERE id=?',(utc_now(),challenge['user_id']))
                    self._audit(db,challenge["user_id"],"auth.login_success","session",session_id,{})
            return self._json(200,{"token":raw_token,"expires_at":expires,"user":dict(user)})
        if path == "/api/registration-requests":
            with closing(connect()) as db:
                request_id = create_registration_request(db, data)
                if not request_id:
                    return self._json(422,{"error":"validation_failed","message":"Проверьте заполненные поля и попробуйте снова."})
            return self._json(201,{"request_id":request_id,"status":"pending"})
        if path == "/api/projects":
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user:
                    return self._json(401,{"error":"unauthorized"})
                if user["role_code"] not in ("founder","fund_staff"):
                    return self._json(403,{"error":"forbidden"})
                if user['role_code']=='fund_staff' and not data.get('founder_id'):
                    return self._json(422,{'error':'validation_failed','message':'Выберите основателя проекта.'})
                with transaction(db):
                    key=str(data.get('request_key',''))[:100]
                    receipt=db.execute('SELECT * FROM request_receipts WHERE user_id=? AND request_key=?',(user['id'],key)).fetchone() if key else None
                    fingerprint=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
                    if receipt:
                        if receipt['path']!=path or receipt['fingerprint']!=fingerprint: return self._json(409,{'error':'invalid_request'})
                        return self._json(200,json.loads(receipt['response_json']))
                    code = normalize_project_code(data.get("code", ""))
                    if len(code)<2: return self._json(422,{'error':'validation_failed','message':'Код проекта должен содержать минимум 2 буквы или цифры.'})
                    if db.execute('SELECT 1 FROM projects WHERE code=?',(code,)).fetchone(): return self._json(409,{'error':'duplicate_code','message':'Этот код проекта уже занят. Укажите другой.'})
                    project = create_founder_project(db, user, data)
                    if not project: return self._json(422,{'error':'validation_failed','message':'Проверьте обязательные поля, УГТ и названия этапов дерева.'})
                    self._audit(db,user['id'],'project.created','project',project['public_id'],{'status':'draft','stage_count':project['stage_count']})
                    if key: db.execute('INSERT INTO request_receipts(user_id,request_key,path,fingerprint,response_json) VALUES(?,?,?,?,?)',(user['id'],key,path,fingerprint,json.dumps({'project':project})))
            return self._json(201,{"project":project})
        if path == "/api/messages":
            with closing(connect()) as db:
                user = self._bearer_user(db)
                if not user:
                    return self._json(401, {"error": "unauthorized"})
                recipient = db.execute("SELECT id FROM users WHERE public_id=? AND id!=? AND status='active' AND role_id!=(SELECT id FROM roles WHERE code='super_admin')", (data.get("recipient_id"),user["id"])).fetchone()
                body = str(data.get("body", "")).strip()
                if not recipient or not 1 <= len(body) <= 4000:
                    return self._json(422, {"error": "validation_failed", "message": "Выберите собеседника и введите сообщение до 4000 символов."})
                with transaction(db):
                    key=str(data.get('request_key',''))[:100]
                    fingerprint=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
                    receipt=db.execute('SELECT * FROM request_receipts WHERE user_id=? AND request_key=?',(user['id'],key)).fetchone() if key else None
                    if receipt:
                        if receipt['path']!=path or receipt['fingerprint']!=fingerprint: return self._json(409,{'error':'invalid_request'})
                        return self._json(200,json.loads(receipt['response_json']))
                    message_id = public_id("msg")
                    db.execute("INSERT INTO direct_messages(public_id,sender_id,recipient_id,body) VALUES(?,?,?,?)", (message_id,user["id"],recipient["id"],body))
                    if key: db.execute('INSERT INTO request_receipts(user_id,request_key,path,fingerprint,response_json) VALUES(?,?,?,?,?)',(user['id'],key,path,fingerprint,json.dumps({'message_id':message_id})))
            return self._json(201, {"message_id": message_id})
        if path == "/api/auth/logout":
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return self._json(401,{"error":"unauthorized"})
            with closing(connect()) as db:
                token_hash = hash_token(auth[7:])
                session = db.execute("SELECT id,user_id,public_id FROM auth_sessions WHERE token_hash=? AND revoked_at IS NULL",(token_hash,)).fetchone()
                if not session:
                    return self._json(401,{"error":"unauthorized"})
                db.execute("UPDATE auth_sessions SET revoked_at=? WHERE id=?",(utc_now(),session["id"]))
                self._audit(db,session["user_id"],"auth.logout","session",session["public_id"],{})
            return self._json(200,{"status":"logged_out"})
        return self._json(404,{"error":"not_found"})

    def _audit(self, db, actor_id, action, entity_type, entity_id, metadata):
        db.execute("INSERT INTO audit_log(public_id,actor_id,action,entity_type,entity_public_id,ip_address,metadata_json) VALUES(?,?,?,?,?,?,?)",(public_id("aud"),actor_id,action,entity_type,entity_id,self._client_ip(),json.dumps(metadata,ensure_ascii=False)))


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def run(port: int = 5188):
    init_database()
    host = os.environ.get("BOKOBOK_HOST", "127.0.0.1")
    server = Server((host,port),ApiHandler)
    print(f"Бок о бок: http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 5188)
