import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import db as database
import workflow as w
import server
import sms

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'test.db';database.init_database(self.path);self.db=database.connect(self.path)
        self.users={}
        for n,role in enumerate(('founder','investor','fund_staff','super_admin','other')):
            actual='fund_staff' if role=='other' else role
            uid=w.user_create(self.db,{'role':actual,'full_name':role,'email':role+'@example.test','phone':f'+7999000000{n}','password':'a-strong-test-password'})
            self.users[role]=self.db.execute('SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE public_id=?',(uid,)).fetchone()
        self.p=server.create_founder_project(self.db,self.users['founder'],{'code':'TEST','name':'Research','summary':'Summary','description':'Description','field':'Physics','ugt_level':2,'stages':[{'id':1,'title':'Study','status':'planned','ugt_level':1},{'id':2,'parent':1,'title':'Prototype','status':'planned','ugt_level':2}]})
        self.pid=self.p['public_id']
        self.db.execute('UPDATE projects SET fund_manager_id=? WHERE public_id=?',(self.users['fund_staff']['id'],self.pid))
    def tearDown(self): self.db.close();self.tmp.cleanup()
    def cmd(self,role,action,data=None):
        with database.transaction(self.db): return w.project_command(self.db,self.users[role],self.pid,action,data or {})
    def detail(self,role):return w.project_detail(self.db,self.users[role],self.pid)
    def publish(self):self.cmd('founder','submit',{'summary':'First version'});self.cmd('fund_staff','publish')
    def test_stage_positions_persist_and_clone(self):
        stage=self.detail('founder')['stages'][0]['public_id']
        self.cmd('founder','stage-position',{'stage_id':stage,'map_x':520,'map_y':180})
        saved=self.detail('founder')['stages'][0]
        self.assertEqual((saved['map_x'],saved['map_y']),(520,180))
        for role in ('investor','other'):
            with self.assertRaises(w.Problem):self.cmd(role,'stage-position',{'stage_id':stage,'map_x':120,'map_y':120})
        for value in (-1,50001,True,'100'):
            with self.assertRaises(w.Problem):self.cmd('founder','stage-position',{'stage_id':stage,'map_x':value,'map_y':100})
        self.publish();self.cmd('founder','draft');copied=self.detail('founder')['stages'][0]
        self.assertEqual((copied['map_x'],copied['map_y']),(520,180))
    def test_stage_outcome_permissions_and_persistence(self):
        detail=self.detail('founder');stage=detail['stages'][0]['public_id']
        self.assertTrue(detail['can_conclude'])
        self.assertFalse(self.detail('fund_staff')['can_conclude'])
        for role in ('fund_staff','super_admin','investor','other'):
            with self.assertRaises(w.Problem):self.cmd(role,'stage-outcome',{'stage_id':stage,'outcome':'success','outcome_note':'Result'})
        for outcome in ('success','failure','inconclusive'):
            self.cmd('founder','stage-outcome',{'stage_id':stage,'outcome':outcome,'outcome_note':'Подтверждено результатами проверки.'})
            saved=self.detail('founder')['stages'][0]
            self.assertEqual(saved['outcome'],outcome);self.assertEqual(saved['status'],'completed');self.assertTrue(saved['outcome_at'])
        with self.assertRaises(w.Problem):self.cmd('founder','stage-outcome',{'stage_id':stage,'outcome':'invalid','outcome_note':'Result'})
        with self.assertRaises(w.Problem):self.cmd('founder','stage-outcome',{'stage_id':stage,'outcome':'success','outcome_note':''})
        self.publish();self.assertFalse(self.detail('founder')['can_conclude'])
        with self.assertRaises(w.Problem):self.cmd('founder','stage-outcome',{'stage_id':stage,'outcome':'success','outcome_note':'Result'})
        self.cmd('founder','draft')
        copied=self.detail('founder')['stages'][0]
        self.assertEqual(copied['outcome'],'inconclusive');self.assertEqual(copied['outcome_note'],'Подтверждено результатами проверки.')
    def test_role_scoping(self):
        for role in ('investor','other'):
            with self.assertRaises(w.Problem): self.detail(role)
            self.assertEqual(w.project_list(self.db,self.users[role])['items'],[])
        self.assertTrue(self.detail('founder')['can_edit']);self.assertTrue(self.detail('fund_staff')['can_review'])
        with self.assertRaises(w.Problem): self.cmd('founder','publish')
    def test_team_access_and_removal(self):
        uid=w.user_create(self.db,{'role':'founder','full_name':'Researcher','email':'researcher@example.test','phone':'+79991112233','password':'a-strong-test-password'})
        researcher=self.db.execute('SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=?',(uid,)).fetchone()
        self.users['researcher']=researcher
        with self.assertRaises(w.Problem):w.project_detail(self.db,researcher,self.pid)
        self.cmd('founder','team',{'user_id':uid,'member_role':'researcher'})
        self.assertTrue(w.project_detail(self.db,researcher,self.pid)['can_edit'])
        self.assertEqual(len(w.project_list(self.db,researcher)['items']),1)
        with database.transaction(self.db): w.project_command(self.db,researcher,self.pid,'stage-update',{'stage_id':self.detail('founder')['stages'][0]['public_id'],'title':'Researcher result'})
        self.assertEqual(self.detail('founder')['stages'][0]['title'],'Researcher result')
        self.cmd('fund_staff','team',{'user_id':uid,'member_role':'viewer'})
        self.assertFalse(w.project_detail(self.db,researcher,self.pid)['can_edit'])
        with self.assertRaises(w.Problem):
            with database.transaction(self.db): w.project_command(self.db,researcher,self.pid,'card',{'name':'Denied'})
        self.cmd('founder','team',{'user_id':uid,'member_role':'viewer','enabled':False})
        with self.assertRaises(w.Problem):w.project_detail(self.db,researcher,self.pid)
        with self.assertRaises(w.Problem):self.cmd('other','team',{'user_id':uid,'member_role':'researcher'})
    def test_founder_changes_show_only_accessible_projects(self):
        another=w.user_create(self.db,{'role':'founder','full_name':'Other founder','email':'other-founder@example.test','phone':'+79994443322','password':'a-strong-test-password'})
        other_user=self.db.execute('SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=?',(another,)).fetchone()
        other_project=server.create_founder_project(self.db,other_user,{'code':'OTHER','name':'Other research','summary':'Summary','description':'Description','field':'Physics','ugt_level':2,'stages':[{'id':1,'title':'Private stage'}]})
        w.audit(self.db,self.users['founder'],'tree.card',self.pid,{'changes':{'name':{'before':'A','after':'B'}}})
        w.audit(self.db,other_user,'tree.card',other_project['public_id'])
        changes=w.founder_changes(self.db,self.users['founder'])['items']
        self.assertEqual([item['project_public_id'] for item in changes],[self.pid])
        self.assertEqual(changes[0]['project_name'],'Research')
        with self.assertRaises(w.Problem):w.founder_changes(self.db,self.users['investor'])
        self.db.commit()
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(self.handler('/api/changes',{}).do_GET()[0],200)
            self.assertEqual(self.handler('/api/changes',{},'investor').do_GET()[0],403)
    def test_founder_changes_filter_search_and_pagination(self):
        for number in range(35):
            w.audit(self.db,self.users['founder'],'tree.card',self.pid,{'comment':f'Правка {number}'})
        first=w.founder_changes(self.db,self.users['founder'])
        self.assertEqual(len(first['items']),30)
        self.assertTrue(first['next_cursor'])
        second=w.founder_changes(self.db,self.users['founder'],f'before={first["next_cursor"]}')
        self.assertEqual(len(second['items']),5)
        self.assertIsNone(second['next_cursor'])
        self.assertFalse(set(i['public_id'] for i in first['items']) & set(i['public_id'] for i in second['items']))
        self.assertEqual(len(w.founder_changes(self.db,self.users['founder'],'q=Правка%2034')['items']),1)
        self.assertEqual(len(w.founder_changes(self.db,self.users['founder'],f'project={self.pid}')['items']),30)
        self.assertEqual(w.founder_changes(self.db,self.users['founder'],'project=unknown')['items'],[])
    def test_admin_audit_filters_and_pagination(self):
        for number in range(55):
            w.audit(self.db,self.users['founder'],'tree.card',self.pid,{'number':number})
        w.audit(self.db,self.users['fund_staff'],'project.assigned',self.pid)
        first=server.audit_entries(self.db,'action=tree.card&actor=founder&entity=project')
        self.assertEqual(len(first['items']),50)
        self.assertIsNotNone(first['next_cursor'])
        second=server.audit_entries(self.db,'action=tree.card&actor=founder&entity=project&before='+str(first['next_cursor']))
        self.assertEqual(len(second['items']),5)
        self.assertIsNone(second['next_cursor'])
        self.assertTrue(all(item['action']=='tree.card' for item in first['items']+second['items']))
        with self.assertRaises(ValueError):server.audit_entries(self.db,'from=2026-99-99')
        self.db.commit()
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(self.handler('/api/admin/audit?action=tree.card',{},'investor').do_GET()[0],403)
            self.assertEqual(self.handler('/api/admin/audit?action=tree.card',{},'super_admin').do_GET()[1]['items'][0]['action'],'tree.card')
    def test_client_ip_only_trusted_from_private_proxy(self):
        h=self.handler('/api/auth/login',{})
        h.headers={'X-Real-IP':'203.0.113.17'}
        with patch.dict('os.environ',{'BOKOBOK_TRUST_PROXY':'1'}):
            h.client_address=('172.18.0.2',0)
            self.assertEqual(h._client_ip(),'203.0.113.17')
            h.client_address=('8.8.8.8',0)
            self.assertEqual(h._client_ip(),'8.8.8.8')
            h.client_address=('172.18.0.2',0)
            h.headers={'X-Real-IP':'203.0.113.17, 198.51.100.2'}
            self.assertEqual(h._client_ip(),'172.18.0.2')
        with patch.dict('os.environ',{'BOKOBOK_TRUST_PROXY':'0'}):
            h.headers={'X-Real-IP':'203.0.113.17'}
            self.assertEqual(h._client_ip(),'172.18.0.2')
    def test_login_limit_is_scoped_to_forwarded_client(self):
        for index in range(20):
            self.db.execute("INSERT INTO audit_log(public_id,action,entity_type,ip_address) VALUES(?,?,'user',?)",(database.public_id('aud'),'auth.login_failed','203.0.113.17'))
        h=self.handler('/api/auth/login',{'identity':'nobody@example.test','password':'wrong'})
        h.client_address=('172.18.0.2',0)
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)),patch.dict('os.environ',{'BOKOBOK_TRUST_PROXY':'1'}):
            h.headers={'X-Real-IP':'203.0.113.17'}
            self.assertEqual(h.do_POST()[0],429)
            h.headers={'X-Real-IP':'203.0.113.18'}
            self.assertEqual(h.do_POST()[0],401)
    def test_published_snapshot_and_new_version(self):
        self.publish();first=self.detail('investor');self.cmd('founder','draft');current=self.detail('founder')
        self.assertNotEqual(first['stages'][0]['public_id'],current['stages'][0]['public_id'])
        self.cmd('founder','card',{'name':'Unpublished title','status':'completed'})
        self.assertEqual(self.detail('investor')['project']['name'],'Research')
        self.assertEqual(self.detail('founder')['project']['name'],'Unpublished title')
        self.cmd('founder','submit',{'summary':'Final result'});self.cmd('fund_staff','publish')
        self.assertEqual(self.detail('investor')['project']['name'],'Unpublished title')
        row=self.db.execute('SELECT * FROM published_project_overview').fetchone();self.assertEqual(row['stage_count'],2);self.assertEqual(row['status'],'completed')
    def test_review_lock_rejection(self):
        self.cmd('founder','submit',{'summary':'Please review'})
        with self.assertRaises(w.Problem):self.cmd('founder','card',{'name':'Forbidden'})
        self.cmd('fund_staff','reject',{'comment':'Add methodology'})
        self.assertEqual(self.detail('founder')['tree_version']['review_comment'],'Add methodology')
        self.cmd('founder','draft');self.assertTrue(self.detail('founder')['can_edit'])
    def test_cycle_rejected_and_delete_reparents(self):
        stages=self.detail('founder')['stages'];root,child=stages
        with self.assertRaises(w.Problem):self.cmd('founder','stage-update',{'stage_id':root['public_id'],'title':'Study','parent':child['public_id']})
        self.cmd('founder','stage-delete',{'stage_id':root['public_id']});self.assertIsNone(self.detail('founder')['stages'][0]['parent_public_id'])
    def test_large_branching_tree_stays_navigable_in_api(self):
        ids=[stage['public_id'] for stage in self.detail('founder')['stages']]
        for number in range(3,101):
            result=self.cmd('founder','stages',{'title':f'Этап {number}','parent':ids[(number-2)//2],'ugt_level':min(9,1+number//12)})
            ids.append(result['stage_id'])
        detail=self.detail('founder')
        self.assertEqual(len(detail['stages']),100)
        self.assertEqual(len({stage['public_id'] for stage in detail['stages']}),100)
        self.assertTrue(all(stage['parent_public_id'] in ids for stage in detail['stages'][2:]))
        self.assertEqual(w.project_list(self.db,self.users['founder'])['items'][0]['stage_count'],100)
    def test_stage_status_and_revision(self):
        first=self.detail('founder');sid=first['stages'][0]['public_id']
        self.cmd('founder','stage-update',{'stage_id':sid,'title':'Done','status':'completed','progress':2,'revision':0})
        saved=self.detail('founder')['stages'][0];self.assertEqual(saved['progress'],100);self.assertTrue(saved['completed_at'])
        with self.assertRaises(w.Problem):self.cmd('founder','card',{'name':'Old','revision':0})
    def test_stage_criteria_survive_publication_and_new_version(self):
        sid=self.detail('founder')['stages'][0]['public_id']
        self.cmd('founder','stage-update',{'stage_id':sid,'title':'Study','criteria_text':'[x] Проверен образец\n[ ] Повторный анализ','attention_note':'Ждём результаты'})
        self.publish()
        public=self.detail('investor')['stages'][0]
        self.assertEqual(public['criteria_text'],'[x] Проверен образец\n[ ] Повторный анализ')
        self.assertEqual(public['attention_note'],'Ждём результаты')
        self.cmd('founder','draft')
        copied=self.detail('founder')['stages'][0]
        self.assertEqual(copied['criteria_text'],public['criteria_text'])
        self.assertEqual(copied['attention_note'],public['attention_note'])
    def test_material_copied_and_private(self):
        self.cmd('founder','material',{'stage_id':self.detail('founder')['stages'][0]['public_id'],'title':'results.txt','content':base64.b64encode(b'Results').decode()})
        self.publish();self.cmd('founder','draft');detail=self.detail('founder');self.assertEqual(len(detail['materials']),1)
        self.cmd('founder','material-delete',{'material_id':detail['materials'][0]['public_id']})
        self.assertEqual(len(self.detail('investor')['materials']),1)
    def test_questions_reply_and_notifications(self):
        self.publish();self.cmd('investor','subscribe')
        q=self.cmd('investor','questions',{'body':'What is the result?'})
        self.assertEqual(len(self.detail('fund_staff')['questions']),1);self.assertEqual(self.detail('founder')['questions'],[])
        self.cmd('fund_staff','reply',{'question_id':q['question_id'],'body':'See published results.'})
        self.assertEqual(len(self.detail('investor')['questions'][0]['replies']),1)
        self.assertTrue(self.db.execute("SELECT 1 FROM notifications WHERE user_id=? AND type='answer'",(self.users['investor']['id'],)).fetchone())
        self.cmd('founder','draft');self.cmd('founder','submit',{'summary':'Update'});self.cmd('fund_staff','publish')
        self.assertTrue(self.db.execute("SELECT 1 FROM notifications WHERE user_id=? AND type='publication'",(self.users['investor']['id'],)).fetchone())
    def test_admin_approval_and_blocking(self):
        rid=server.create_registration_request(self.db,{'full_name':'New founder','email':'new@example.test','organization':'Lab','password':'my-strong-password'})
        with database.transaction(self.db): approval=w.admin_command(self.db,self.users['super_admin'],'registration',{'request_id':rid,'decision':'approve'})
        self.assertEqual(self.db.execute('SELECT status FROM registration_requests WHERE public_id=?',(rid,)).fetchone()[0],'approved')
        self.assertNotIn('temporary_password',approval)
        created=self.db.execute('SELECT phone,password_hash FROM users WHERE public_id=?',(approval['user_id'],)).fetchone()
        self.assertIsNone(created['phone'])
        self.assertTrue(database.verify_password('my-strong-password',created['password_hash']))
        legacy=self.db.execute("INSERT INTO registration_requests(public_id,requested_role,full_name,email,organization) VALUES('reg_legacy','founder','Legacy founder','legacy@example.test','Lab')")
        with database.transaction(self.db): legacy_approval=w.admin_command(self.db,self.users['super_admin'],'registration',{'request_id':'reg_legacy','decision':'approve'})
        self.assertGreaterEqual(len(legacy_approval['temporary_password']),12)
        legacy_user=self.db.execute('SELECT password_hash FROM users WHERE public_id=?',(legacy_approval['user_id'],)).fetchone()
        self.assertTrue(database.verify_password(legacy_approval['temporary_password'],legacy_user['password_hash']))
        with self.assertRaises(w.Problem):w.admin_command(self.db,self.users['investor'],'users',{})
        w.admin_command(self.db,self.users['super_admin'],'user-update',{'user_id':self.users['investor']['public_id'],'status':'blocked'})
        self.db.execute("INSERT INTO auth_sessions(public_id,user_id,token_hash,expires_at) VALUES('session',?,?,'2099-01-01T00:00:00Z')",(self.users['investor']['id'],database.hash_token('test-token')))
        h=server.ApiHandler.__new__(server.ApiHandler);h.headers={'Authorization':'Bearer test-token'};self.assertIsNone(h._bearer_user(self.db))
    def handler(self,path,data,role='founder'):
        h=server.ApiHandler.__new__(server.ApiHandler);h.path=path;h.headers={};h.client_address=('127.0.0.1',0);h._body=lambda:dict(data);h._bearer_user=lambda db:self.users[role];h._json=lambda status,payload:(status,payload);return h
    def test_idempotency_and_conflict(self):
        h=self.handler('/api/projects/'+self.pid+'/stages',{'title':'New','request_key':'test-retry'})
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):a=h.do_POST();b=h.do_POST()
        self.assertEqual(a[1]['stage_id'],b[1]['stage_id']);self.assertEqual(len(self.detail('founder')['stages']),3)
        h._body=lambda:{'title':'Different','request_key':'test-retry'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):self.assertEqual(h.do_POST()[0],409)
    def test_message_retry_does_not_duplicate_delivery(self):
        payload={'recipient_id':self.users['fund_staff']['public_id'],'body':'Проверка связи','request_key':'message-retry'}
        h=self.handler('/api/messages',payload)
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            first=h.do_POST();repeat=h.do_POST()
        self.assertEqual(first[0],201)
        self.assertEqual(repeat[0],200)
        self.assertEqual(first[1]['message_id'],repeat[1]['message_id'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM direct_messages').fetchone()[0],1)
        h._body=lambda:{**payload,'body':'Другой текст'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(h.do_POST()[0],409)
    def test_otp_attempts_consumption_and_last_login(self):
        uid=self.users['founder']['id'];self.db.execute("INSERT INTO otp_challenges(public_id,user_id,purpose,code_hash,expires_at) VALUES('test',?,'login',?,'2099-01-01T00:00:00Z')",(uid,database.hash_token('123456')))
        h=self.handler('/api/auth/verify-otp',{'challenge_id':'test','code':'000000'})
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):self.assertEqual(h.do_POST()[0],401)
        h._body=lambda:{'challenge_id':'test','code':'123456'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):self.assertEqual(h.do_POST()[0],200);self.assertEqual(h.do_POST()[0],401)
        self.assertTrue(self.db.execute('SELECT last_login_at FROM users WHERE id=?',(uid,)).fetchone()[0])
    def test_static_secrets_denied(self):
        for path in ('/data/bokobok.db','/backend/server.py','/.env','/%2e%2e/data/bokobok.db','/db/migrations/001_initial.sql'):
            h=self.handler(path,{});self.assertEqual(h.do_GET()[0],404)
    def test_sms_fail_closed(self):
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaises(sms.DeliveryError):sms.send_code('+79990000000','123456','test')
    def test_local_password_login_skips_sms_but_public_bind_does_not(self):
        h=self.handler('/api/auth/login',{'identity':'founder@example.test','password':'a-strong-test-password'})
        h.headers={'User-Agent':'test'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)), patch.dict('os.environ',{'BOKOBOK_HOST':'127.0.0.1','BOKOBOK_DISABLE_SMS_2FA':'1'}), patch.object(server,'send_code') as send:
            status,result=h.do_POST()
        self.assertEqual(status,200)
        self.assertEqual(result['user']['role'],'founder')
        self.assertIn('token',result)
        send.assert_not_called()
        h.headers={'Authorization':'Bearer '+result['token']}
        self.assertEqual(h._bearer_user(self.db)['id'],self.users['founder']['id'])
        h.headers={'User-Agent':'test'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)), patch.dict('os.environ',{'BOKOBOK_HOST':'0.0.0.0','BOKOBOK_DISABLE_SMS_2FA':'1'}), patch.object(server,'send_code') as send:
            status,result=h.do_POST()
        self.assertEqual(status,200)
        self.assertIn('challenge_id',result)
        self.assertNotIn('token',result)
        send.assert_called_once()
    def test_profile_updates_password_and_revokes_other_sessions(self):
        user=self.users['founder']
        for sid,token in [('current','current-token'),('other','other-token')]:
            self.db.execute("INSERT INTO auth_sessions(public_id,user_id,token_hash,expires_at) VALUES(?,?,?,'2099-01-01T00:00:00Z')",(sid,user['id'],database.hash_token(token)))
        profile=self.handler('/api/profile',{})
        profile.headers={'Authorization':'Bearer current-token'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            status,result=profile.do_GET()
        self.assertEqual(status,200)
        self.assertEqual(len(result['sessions']),2)
        self.assertEqual(sum(session['current'] for session in result['sessions']),1)
        profile._body=lambda:{'full_name':'Новое имя','organization':'Новая лаборатория'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(profile.do_POST()[0],200)
        self.assertEqual(self.db.execute('SELECT full_name FROM users WHERE id=?',(user['id'],)).fetchone()[0],'Новое имя')
        password=self.handler('/api/profile/password',{'current_password':'wrong','new_password':'new-strong-password'})
        password.headers={'Authorization':'Bearer current-token'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(password.do_POST()[0],403)
        password._body=lambda:{'current_password':'a-strong-test-password','new_password':'new-strong-password'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
            self.assertEqual(password.do_POST()[0],200)
        self.assertTrue(database.verify_password('new-strong-password',self.db.execute('SELECT password_hash FROM users WHERE id=?',(user['id'],)).fetchone()[0]))
        self.assertIsNone(self.db.execute("SELECT revoked_at FROM auth_sessions WHERE public_id='current'").fetchone()[0])
        self.assertIsNotNone(self.db.execute("SELECT revoked_at FROM auth_sessions WHERE public_id='other'").fetchone()[0])
    def test_password_only_login_requires_trusted_https_proxy_on_public_bind(self):
        h=self.handler('/api/auth/login',{'identity':'founder@example.test','password':'a-strong-test-password'})
        h.headers={'User-Agent':'test','X-Forwarded-Proto':'https'}
        env={'BOKOBOK_HOST':'0.0.0.0','BOKOBOK_DISABLE_SMS_2FA':'1','BOKOBOK_TRUST_PROXY':'1'}
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)), patch.dict('os.environ',env), patch.object(server,'send_code') as send:
            status,result=h.do_POST()
        self.assertEqual(status,200)
        self.assertIn('token',result)
        send.assert_not_called()
        h.client_address=('203.0.113.10',0)
        with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)), patch.dict('os.environ',env), patch.object(server,'send_code') as send:
            status,result=h.do_POST()
        self.assertEqual(status,200)
        self.assertIn('challenge_id',result)
        send.assert_called_once()
    def test_failed_command_rolls_back(self):
        before=self.db.execute('SELECT COUNT(*) FROM tree_versions').fetchone()[0]
        with self.assertRaises(w.Problem):self.cmd('founder','draft')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM tree_versions').fetchone()[0],before)

if __name__=='__main__':unittest.main()

class FullApiScenarioTests(unittest.TestCase):
    setUp=WorkflowTests.setUp
    tearDown=WorkflowTests.tearDown
    cmd=WorkflowTests.cmd
    detail=WorkflowTests.detail
    def test_api_full_cycle_with_real_sessions(self):
        tokens={}
        for role,user in self.users.items():
            token='test-session-'+role;tokens[role]=token
            self.db.execute('INSERT INTO auth_sessions(public_id,user_id,token_hash,expires_at) VALUES(?,?,?,?)',(database.public_id('ses'),user['id'],database.hash_token(token),'2099-01-01T00:00:00Z'))
        def request(role,path,payload=None):
            h=server.ApiHandler.__new__(server.ApiHandler);h.path=path;h.headers={'Authorization':'Bearer '+tokens[role]};h.client_address=('127.0.0.1',0);h._body=lambda:payload or {};h._json=lambda status,data:(status,data)
            with patch.object(server,'connect',side_effect=lambda:database.connect(self.path)):
                return h.do_GET() if payload is None else h.do_POST()
        status,detail=request('founder','/api/projects/'+self.pid);self.assertEqual(status,200)
        sid=detail['stages'][0]['public_id']
        self.assertEqual(request('founder',f'/api/projects/{self.pid}/stage-update',{'stage_id':sid,'title':'Verified','status':'completed','ugt_level':2,'revision':0})[0],200)
        self.assertEqual(request('founder',f'/api/projects/{self.pid}/submit',{'summary':'Confirmed results','revision':1})[0],200)
        self.assertEqual(request('founder',f'/api/projects/{self.pid}/publish',{})[0],403)
        self.assertEqual(request('other',f'/api/projects/{self.pid}/publish',{})[0],404)
        self.assertEqual(request('fund_staff',f'/api/projects/{self.pid}/publish',{})[0],200)
        status,detail=request('investor','/api/projects/'+self.pid);self.assertEqual(status,200);self.assertEqual(detail['stages'][0]['progress'],100)
        self.assertFalse(detail['can_edit'])
        self.assertEqual(request('investor',f'/api/projects/{self.pid}/stage-delete',{'stage_id':sid})[0],403)
        status,q=request('investor',f'/api/projects/{self.pid}/questions',{'body':'Which method?','request_key':'question-retry'});self.assertEqual(status,201)
        self.assertEqual(request('fund_staff',f'/api/projects/{self.pid}/reply',{'question_id':q['question_id'],'body':'The documented method.'})[0],200)
        self.assertEqual(request('investor','/api/notifications')[1]['items'][0]['title'],'Ответ на ваш вопрос')
        self.assertEqual(request('investor','/api/auth/logout',{})[0],200)
        self.assertEqual(request('investor','/api/projects')[0],401)

    def test_backup_restore_keeps_tree_and_material(self):
        self.cmd('founder','material',{'stage_id':self.detail('founder')['stages'][0]['public_id'],'title':'result','content':base64.b64encode(b'result').decode()})
        target=database.connect(Path(self.tmp.name)/'backup.db');self.db.backup(target)
        self.assertEqual(target.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(target.execute('SELECT COUNT(*) FROM evidence').fetchone()[0],1)
        self.assertEqual(target.execute('SELECT COUNT(*) FROM stages').fetchone()[0],2)
        target.close()
