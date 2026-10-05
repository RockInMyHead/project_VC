import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import db as db_module
import server as server_module


class RegistrationApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test.db"
        server_module.init_database(self.db_path)
        self.db = db_module.connect(self.db_path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_public_registration_is_founder_only(self):
        base = {"full_name": "Анна Петрова", "email": "anna@example.ru", "organization": "Lab", "password": "strong-founder-password"}

        blocked = server_module.create_registration_request(self.db, {**base, "requested_role": "investor"})
        self.assertIsNone(blocked)

        request_id = server_module.create_registration_request(self.db, base)
        self.assertTrue(request_id.startswith("reg_"))

        row = self.db.execute("SELECT requested_role,full_name,email,organization,password_hash FROM registration_requests").fetchone()
        self.assertEqual({key:row[key] for key in ('requested_role','full_name','email','organization')}, {key:base[key] for key in ('full_name','email','organization')} | {'requested_role':'founder'})
        self.assertTrue(db_module.verify_password(base['password'],row['password_hash']))
        self.assertIsNone(server_module.create_registration_request(self.db,{**base,'email':'invalid@example.ru','password':'short'}))
        self.assertEqual(server_module.create_registration_request(self.db,{**base,'password':'different-founder-pass'}),request_id)
        self.assertTrue(db_module.verify_password(base['password'],self.db.execute('SELECT password_hash FROM registration_requests WHERE public_id=?',(request_id,)).fetchone()[0]))


if __name__ == "__main__":
    unittest.main()
