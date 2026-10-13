"""Move the seeded lab video to AGCT-HIV and attach its supplied portrait.

Preview: python backend/move_agct_media.py
Apply after backup: python backend/move_agct_media.py --apply
"""
from __future__ import annotations

import argparse
import json

from db import connect, transaction
from seed_roadmaps import ASSETS, UPLOADS, add_material

TARGET_STAGE = 'Производство и документы'
SOURCE_STAGE = 'Создание коллекции штаммов'
VIDEO_TITLE = 'Лабораторная работа — иллюстративное видео (крупный план)'
PHOTO_TITLE = 'Портрет участника проекта'


def stage(db, code: str, title: str):
    rows = db.execute('''SELECT s.id,p.public_id project_id,p.founder_id
        FROM stages s JOIN tree_versions v ON v.id=s.tree_version_id
        JOIN projects p ON p.id=v.project_id
        WHERE p.code=? AND s.title=? AND v.state='published'
        ORDER BY v.version_number DESC LIMIT 2''', (code, title)).fetchall()
    if len(rows) != 1:
        raise ValueError(f'Ожидался один опубликованный этап: {code} / {title}; найдено {len(rows)}.')
    return rows[0]


def move_agct_media(db, apply: bool = False) -> dict:
    source = stage(db, 'GLUTEN-FREE-YEAST', SOURCE_STAGE)
    target = stage(db, 'AGCT-HIV', TARGET_STAGE)
    video = db.execute('''SELECT * FROM evidence WHERE stage_id=? AND title=? AND mime_type='video/mp4' ''',
                       (source['id'], VIDEO_TITLE)).fetchall()
    target_video = db.execute('''SELECT * FROM evidence WHERE stage_id=? AND title=? AND mime_type='video/mp4' ''',
                              (target['id'], VIDEO_TITLE)).fetchall()
    if len(video) + len(target_video) != 1:
        raise ValueError('Видео отсутствует или найдено несколько копий. Изменения не внесены.')
    photo = db.execute('SELECT id FROM evidence WHERE stage_id=? AND title=? AND mime_type=?',
                       (target['id'], PHOTO_TITLE, 'image/jpeg')).fetchall()
    if len(photo) > 1:
        raise ValueError('Найдено несколько фотографий в целевом этапе.')
    asset = ASSETS / 'agct-portrait.jpg'
    if not photo and not asset.is_file():
        raise ValueError('Фотография отсутствует в seed_assets.')
    video_row = video[0] if video else target_video[0]
    key = video_row['storage_key']
    if not key.startswith('file:') or not (UPLOADS / key[5:]).is_file():
        raise ValueError('Файл видео не найден в хранилище. Изменения не внесены.')
    result = {'from': 'GLUTEN-FREE-YEAST / ' + SOURCE_STAGE,
              'to': 'AGCT-HIV / ' + TARGET_STAGE,
              'video_moved': bool(video), 'photo_added': not bool(photo), 'applied': False}
    if apply and (video or not photo):
        with transaction(db):
            if video:
                db.execute('UPDATE evidence SET stage_id=? WHERE id=?', (target['id'], video[0]['id']))
            if not photo:
                add_material(db, target['id'], target['founder_id'], asset.name, PHOTO_TITLE, 'image/jpeg')
        result['applied'] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with connect() as db:
        try:
            result = move_agct_media(db, args.apply)
        except ValueError as error:
            parser.exit(1, str(error) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
