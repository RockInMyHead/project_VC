import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.db import connect, hash_password, init_database, verify_password


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "test.db"
        init_database(self.path)
        self.db = connect(self.path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_reference_data_and_integrity(self):
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM roles").fetchone()[0], 4)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM projects").fetchone()[0], 0)

    def test_foreign_keys_are_enforced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO projects(public_id,code,slug,name,summary,field,founder_id) VALUES('bad','BAD','bad','Bad','Bad','Bad',99999)")

    def test_password_hash_is_salted_and_verifiable(self):
        one = hash_password("secret")
        two = hash_password("secret")
        self.assertNotEqual(one, two)
        self.assertTrue(verify_password("secret", one))
        self.assertFalse(verify_password("wrong", one))

    def test_empty_database_has_no_product_content(self):
        for table in ("users", "projects", "tree_versions", "stages", "project_questions", "audit_log"):
            self.assertEqual(self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
