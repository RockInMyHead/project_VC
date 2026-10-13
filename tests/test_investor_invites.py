import secrets
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import db as database
import server
import workflow


class InvestorInviteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = database.connect(database.init_database(Path(self.temp.name) / 'test.db'))
        self.code = secrets.token_urlsafe(32)
        admin = workflow.user_create(self.db, {'role':'super_admin','full_name':'Admin',
            'email':'admin@example.test','phone':'+79990000001','password':'very-strong-password'})
        admin_id = self.db.execute('SELECT id FROM users WHERE public_id=?', (admin,)).fetchone()[0]
        expires = (datetime.now(timezone.utc)+timedelta(days=7)).isoformat(timespec='milliseconds').replace('+00:00','Z')
        self.db.execute('INSERT INTO investor_invites(public_id,token_hash,created_by,max_uses,expires_at) VALUES(?,?,?,?,?)',
            ('inv_test',database.hash_token(self.code),admin_id,2,expires))

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def redeem(self, browser):
        with database.transaction(self.db):
            return server.redeem_investor_invite(self.db,self.code,browser,'127.0.0.1','Test browser')

    def test_each_browser_gets_own_investor_and_repeat_reuses_account(self):
        first=self.redeem('a'*40)
        second=self.redeem('b'*40)
        again=self.redeem('a'*40)
        self.assertEqual(first['user']['role'],'investor')
        self.assertNotEqual(first['user']['public_id'],second['user']['public_id'])
        self.assertEqual(first['user']['public_id'],again['user']['public_id'])
        self.assertNotEqual(first['token'],again['token'])
        self.assertEqual(self.db.execute('SELECT used_count FROM investor_invites').fetchone()[0],2)
        with self.assertRaises(workflow.Problem):self.redeem('c'*40)

    def test_expiry_revoke_and_blocked_account(self):
        first=self.redeem('a'*40)
        self.db.execute("UPDATE users SET status='blocked' WHERE public_id=?",(first['user']['public_id'],))
        with self.assertRaises(workflow.Problem):self.redeem('a'*40)
        self.db.execute("UPDATE users SET status='active' WHERE public_id=?",(first['user']['public_id'],))
        self.db.execute("UPDATE investor_invites SET revoked_at=?",(database.utc_now(),))
        with self.assertRaises(workflow.Problem):self.redeem('b'*40)
        self.assertEqual(self.redeem('a'*40)['user']['public_id'],first['user']['public_id'])
        self.db.execute('UPDATE investor_invites SET revoked_at=NULL,expires_at=?',('2020-01-01T00:00:00.000Z',))
        with self.assertRaises(workflow.Problem):self.redeem('b'*40)
        self.assertEqual(self.redeem('a'*40)['user']['public_id'],first['user']['public_id'])


if __name__ == '__main__':
    unittest.main()
