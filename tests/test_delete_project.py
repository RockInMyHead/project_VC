import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from db import connect, init_database, public_id
from delete_project import delete_project
from server import create_founder_project
from workflow import user_create


class DeleteProjectTests(unittest.TestCase):
    def test_only_exact_old_project_and_its_unshared_file_are_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'bokobok.db'
            init_database(path)
            with connect(path) as db:
                founder_id = user_create(db, {'role': 'founder', 'full_name': 'Founder',
                    'email': 'founder@example.test', 'phone': '+79990000123',
                    'password': 'a-strong-test-password'})
                founder = db.execute('SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=?',
                    (founder_id,)).fetchone()
                def project(code, name):
                    return create_founder_project(db, founder, {'code': code, 'name': name,
                        'summary': 'Summary', 'description': 'Description', 'field': 'Biotech',
                        'stages': [{'id': 1, 'title': 'First step'}]})
                old = project('AGCT-ТЕРАПИЯ', 'Разработка технологии CCR5-TALEN')
                current = project('AGCT-HIV', 'AGCT — терапия ВИЧ')
                uploads = root / 'uploads'
                uploads.mkdir()
                material = uploads / 'old-file.jpg'
                material.write_bytes(b'image')
                db.execute('''INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by)
                    VALUES(?,?,?,?,?,?,?,?)''', (public_id('mat'),
                    db.execute('SELECT id FROM stages WHERE public_id=?', (old['stage_ids']['1'],)).fetchone()[0],
                    'Old file', 'file:old-file.jpg', 'image/jpeg', 5,
                    hashlib.sha256(b'image').hexdigest(), founder['id']))
                preview = delete_project(db, 'AGCT-ТЕРАПИЯ', 'CCR5-TALEN', uploads)
                self.assertFalse(preview['applied'])
                self.assertTrue(material.exists())
                with self.assertRaises(ValueError):
                    delete_project(db, 'AGCT-ТЕРАПИЯ', 'wrong name', uploads, True)
                result = delete_project(db, 'AGCT-ТЕРАПИЯ', 'CCR5-TALEN', uploads, True)
                self.assertTrue(result['applied'])
                self.assertEqual(result['materials'], 1)
                self.assertFalse(material.exists())
                self.assertIsNone(db.execute('SELECT id FROM projects WHERE public_id=?', (old['public_id'],)).fetchone())
                self.assertIsNotNone(db.execute('SELECT id FROM projects WHERE public_id=?', (current['public_id'],)).fetchone())
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')


if __name__ == '__main__':
    unittest.main()
