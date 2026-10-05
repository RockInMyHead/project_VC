import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import db
import seed_demo
import workflow


class DemoSeedTests(unittest.TestCase):
    def test_isolated_demo_is_usable_and_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "demo.db"
            result = seed_demo.create_demo(path, "a-strong-demo-password")
            self.assertTrue(result["created"])
            with db.connect(path) as connection:
                user = connection.execute(
                    "SELECT u.*, r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=?",
                    (result["user_id"],),
                ).fetchone()
                self.assertEqual(user["role_code"], "founder")
                self.assertTrue(db.verify_password("a-strong-demo-password", user["password_hash"]))
                detail = workflow.project_detail(connection, user, result["project_id"])
                self.assertEqual(len(detail["stages"]), 6)
                stages_by_position = {stage["position"]: stage for stage in detail["stages"]}
                self.assertEqual(set(stages_by_position), set(range(1, 7)))
                self.assertEqual(stages_by_position[3]["parent_public_id"], stages_by_position[2]["public_id"])
                self.assertEqual(stages_by_position[4]["parent_public_id"], stages_by_position[2]["public_id"])
                self.assertEqual(len(detail["materials"]), 3)
                self.assertTrue(any(stage["parent_public_id"] for stage in detail["stages"]))
                self.assertTrue(any(stage["attention_note"] for stage in detail["stages"]))
                self.assertIn("демонстрационный", detail["project"]["name"])
            again = seed_demo.create_demo(path)
            self.assertFalse(again["created"])
            self.assertEqual(again["project_id"], result["project_id"])


if __name__ == "__main__":
    unittest.main()
