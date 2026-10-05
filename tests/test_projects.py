import sys
import io
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import db as db_module
import server as server_module
from db import hash_password, public_id


class ProjectCreationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test.db"
        server_module.init_database(self.db_path)
        self.db = db_module.connect(self.db_path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def create_user(self, role):
        role_id = self.db.execute("SELECT id FROM roles WHERE code=?", (role,)).fetchone()[0]
        email = f"{role}@example.ru"
        self.db.execute(
            "INSERT INTO users(public_id,role_id,full_name,email,organization,password_hash,status) VALUES(?,?,?,?,?,?,'active')",
            (public_id("usr"), role_id, role, email, "Lab", hash_password("secret")),
        )
        return self.db.execute("SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=?", (email,)).fetchone()

    def test_founder_creates_project_draft_with_tree(self):
        founder = self.create_user("founder")
        data = {
            "code": "KUMA30",
            "name": "KUMA30",
            "summary": "Краткое описание проекта",
            "description": "Научная база, текущий результат и ближайшая цель.",
            "field": "биотех",
            "region": "Москва",
            "ugt_level": 3,
            "stages": ["Гипотеза", "Прототип", "Пилот"],
        }

        project = server_module.create_founder_project(self.db, founder, data)

        self.assertEqual(project["status"], "draft")
        self.assertEqual(project["stage_count"], 3)
        saved = self.db.execute("SELECT code,status,ugt_level FROM projects WHERE public_id=?", (project["public_id"],)).fetchone()
        self.assertEqual(dict(saved), {"code": "KUMA30", "status": "draft", "ugt_level": 3})
        stages = self.db.execute("SELECT title,status FROM stages ORDER BY position").fetchall()
        self.assertEqual([dict(row) for row in stages], [
            {"title": "Гипотеза", "status": "in_progress"},
            {"title": "Прототип", "status": "planned"},
            {"title": "Пилот", "status": "planned"},
        ])

    def test_only_founder_can_create_project(self):
        investor = self.create_user("investor")
        project = server_module.create_founder_project(self.db, investor, {"code": "AA", "name": "A", "summary": "S", "description": "D", "field": "F"})
        self.assertIsNone(project)

    def test_staff_creates_project_for_active_founder(self):
        founder=self.create_user('founder')
        staff=self.create_user('fund_staff')
        handler=server_module.ApiHandler.__new__(server_module.ApiHandler)
        handler.path='/api/projects';handler.client_address=('127.0.0.1',0);handler.headers={}
        handler._bearer_user=lambda connection:staff
        handler._json=lambda status,payload:(status,payload)
        payload={'code':'STAFF01','name':'Research','summary':'Summary','description':'Description','field':'Science','founder_id':founder['public_id']}
        handler._body=lambda:dict(payload)
        with patch.object(server_module,'connect',side_effect=lambda:db_module.connect(self.db_path)):
            status,result=handler.do_POST()
        self.assertEqual(status,201)
        row=self.db.execute('SELECT founder_id,fund_manager_id FROM projects WHERE public_id=?',(result['project']['public_id'],)).fetchone()
        self.assertEqual((row['founder_id'],row['fund_manager_id']),(founder['id'],staff['id']))
        payload['founder_id']='missing'
        payload['code']='STAFF02'
        with patch.object(server_module,'connect',side_effect=lambda:db_module.connect(self.db_path)):
            self.assertEqual(handler.do_POST()[0],422)

    def test_branch_and_stage_details_are_saved(self):
        founder = self.create_user("founder")
        project = server_module.create_founder_project(self.db, founder, {
            "code": "TREE01", "name": "Tree", "summary": "S", "description": "D", "field": "F", "ugt_level": 3,
            "stages": [
                {"id": 1, "parent": None, "title": "База", "status": "completed", "ugt_level": 1},
                {"id": 2, "parent": 1, "title": "Проверка", "description": "Измерить результат", "status": "in_progress", "ugt_level": 3},
            ],
        })
        self.assertEqual(project["stage_count"], 2)
        rows = self.db.execute("SELECT id,parent_stage_id,title,description,status,progress,ugt_level FROM stages ORDER BY position").fetchall()
        self.assertEqual(rows[1]["parent_stage_id"], rows[0]["id"])
        self.assertEqual((rows[1]["description"], rows[1]["status"], rows[1]["progress"], rows[1]["ugt_level"]), ("Измерить результат", "in_progress", 0, 3))

    def test_stage_choices_and_video_material_survive_creation(self):
        founder=self.create_user('founder')
        project=server_module.create_founder_project(self.db,founder,{
            'code':'MEDIA01','name':'Media','summary':'Summary','description':'Description','field':'Science',
            'stages':[{'id':1,'parent':None,'title':'Проверка','choices':['Успех','Повторить опыт'],'selected_choice':1}],
        })
        self.assertEqual(len(project['stage_ids']),1)
        detail=server_module.workflow.project_detail(self.db,founder,project['public_id'])
        self.assertEqual(detail['stages'][0]['choices'],['Успех','Повторить опыт'])
        self.assertEqual(detail['stages'][0]['selected_choice'],1)
        payload=b'video-test-'*100_000
        handler=server_module.ApiHandler.__new__(server_module.ApiHandler)
        handler.headers={'Content-Length':str(len(payload)),'Content-Type':'video/mp4','X-Stage-Id':project['stage_ids']['1'],'X-File-Name':'%D0%BE%D0%BF%D1%8B%D1%82.mp4'}
        handler.path=f"/api/projects/{project['public_id']}/materials/upload"
        handler.rfile=io.BytesIO(payload)
        handler._bearer_user=lambda db:founder
        handler._json=lambda status,data:(status,data)
        with patch.object(server_module,'UPLOAD_ROOT',Path(self.temp.name)/'uploads'),patch.object(server_module,'connect',side_effect=lambda:db_module.connect(self.db_path)):
            status,result=handler.do_POST()
            self.assertEqual(status,201)
            material=self.db.execute('SELECT title,mime_type,byte_size,storage_key FROM evidence WHERE public_id=?',(result['material_id'],)).fetchone()
            self.assertEqual((material['title'],material['mime_type'],material['byte_size']),('опыт.mp4','video/mp4',len(payload)))
            self.assertTrue(material['storage_key'].startswith('file:'))
            self.assertEqual((server_module.UPLOAD_ROOT/material['storage_key'][5:]).read_bytes(),payload)
            handler.rfile=io.BytesIO(payload)
            self.assertEqual(handler.do_POST(),(200,result))
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM evidence').fetchone()[0],1)
            handler.path=f"/api/projects/{project['public_id']}/materials/{result['material_id']}/download"
            handler.wfile=io.BytesIO()
            response_headers={}
            handler.send_response=lambda status:response_headers.update(status=status)
            handler.send_header=lambda key,value:response_headers.update({key:value})
            handler.end_headers=lambda:None
            handler.do_GET()
            self.assertEqual(handler.wfile.getvalue(),payload)
            self.assertEqual(response_headers['Content-Type'],'video/mp4')

    def test_project_code_accepts_cyrillic(self):
        founder = self.create_user("founder")
        project = server_module.create_founder_project(self.db, founder, {
            "code": "вымы-вс", "name": "Исследование", "summary": "Кратко",
            "description": "Описание", "field": "Наука", "ugt_level": 3,
        })
        self.assertEqual(project["code"], "ВЫМЫ-ВС")

    def test_event_creation_preserves_parent_and_rejects_other_users(self):
        founder = self.create_user("founder")
        project = server_module.create_founder_project(self.db, founder, {
            "code": "EVENTS", "name": "Test", "summary": "Summary", "description": "Description", "field": "Science", "ugt_level": 3,
        })
        parent = self.db.execute("SELECT public_id FROM stages ORDER BY position LIMIT 1").fetchone()[0]
        handler = server_module.ApiHandler.__new__(server_module.ApiHandler)
        handler.path = f'/api/projects/{project["public_id"]}/stages'
        handler.client_address = ('127.0.0.1', 0)
        handler._body = lambda: {"title": "Новая проверка", "parent": parent, "status": "planned", "due_at": "2026-10-01"}
        handler._bearer_user = lambda connection: founder
        handler._json = lambda status, payload: (status, payload)
        with patch.object(server_module, 'connect', side_effect=lambda:db_module.connect(self.db_path)):
            status, result = handler.do_POST()
        self.assertEqual(status, 201)
        saved = self.db.execute("SELECT s.title,s.due_at,p.public_id parent FROM stages s JOIN stages p ON p.id=s.parent_stage_id WHERE s.public_id=?", (result['stage_id'],)).fetchone()
        self.assertEqual(dict(saved), {"title": "Новая проверка", "due_at": "2026-10-01", "parent": parent})
        investor = self.create_user('investor')
        handler._bearer_user = lambda connection: investor
        with patch.object(server_module, 'connect', side_effect=lambda:db_module.connect(self.db_path)):
            self.assertEqual(handler.do_POST()[0], 404)


if __name__ == "__main__":
    unittest.main()
