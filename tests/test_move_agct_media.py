import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from db import connect, init_database, public_id
from move_agct_media import move_agct_media
from server import create_founder_project
from workflow import user_create


class MoveAgctMediaTests(unittest.TestCase):
    def test_moves_existing_video_and_adds_photo_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_database(root / 'test.db')
            assets = root / 'assets'
            uploads = root / 'uploads'
            assets.mkdir()
            uploads.mkdir()
            (assets / 'agct-portrait.jpg').write_bytes(b'portrait')
            (uploads / 'lab.mp4').write_bytes(b'video')
            with connect(root / 'test.db') as db:
                user_id = user_create(db, {'role': 'founder', 'full_name': 'Founder',
                    'email': 'founder@example.test', 'phone': '+79990000124',
                    'password': 'a-strong-test-password'})
                founder = db.execute('SELECT u.*,r.code role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.public_id=?', (user_id,)).fetchone()
                ids = {}
                for code, title in [('GLUTEN-FREE-YEAST', 'Создание коллекции штаммов'),
                                    ('AGCT-HIV', 'Производство и документы')]:
                    created = create_founder_project(db, founder, {'code': code,
                        'name': code, 'summary': 'Summary', 'description': 'Description', 'field': 'Biotech',
                        'stages': [{'id': 1, 'title': title}]})
                    db.execute("UPDATE tree_versions SET state='published' WHERE public_id=?",
                               (created['tree_version'],))
                    ids[code] = db.execute('SELECT id FROM stages WHERE public_id=?',
                        (created['stage_ids']['1'],)).fetchone()[0]
                db.execute('''INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,
                    byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)''',
                    (public_id('mat'), ids['GLUTEN-FREE-YEAST'],
                     'Лабораторная работа — иллюстративное видео (крупный план)',
                     'file:lab.mp4', 'video/mp4', 5, hashlib.sha256(b'video').hexdigest(), founder['id']))
                with patch('move_agct_media.ASSETS', assets), patch('move_agct_media.UPLOADS', uploads), \
                     patch('seed_roadmaps.UPLOADS', uploads), patch('seed_roadmaps.ASSETS', assets):
                    self.assertFalse(move_agct_media(db)['applied'])
                    self.assertTrue(move_agct_media(db, True)['applied'])
                    self.assertFalse(move_agct_media(db, True)['applied'])
                rows = db.execute('SELECT stage_id,mime_type FROM evidence ORDER BY id').fetchall()
                self.assertEqual([(r['stage_id'], r['mime_type']) for r in rows],
                    [(ids['AGCT-HIV'], 'video/mp4'), (ids['AGCT-HIV'], 'image/jpeg')])


if __name__ == '__main__':
    unittest.main()
