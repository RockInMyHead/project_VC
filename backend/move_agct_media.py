"""Move the seeded lab video and all supplied portraits to early AGCT-HIV stage.

Preview: python backend/move_agct_media.py
Apply after backup: python backend/move_agct_media.py --apply
"""
from __future__ import annotations

import argparse
import json

from db import connect, transaction
from seed_roadmaps import ASSETS, UPLOADS, add_material

TARGET_STAGE = 'Начало НИР'
PREVIOUS_STAGE = 'Производство и документы'
SOURCE_STAGE = 'Создание коллекции штаммов'
VIDEO_TITLE = 'Лабораторная работа — иллюстративное видео (крупный план)'
PHOTOS = (
    ('agct-portrait.jpg', 'Портрет участника проекта'),
    ('agct-portrait-2.jpg', 'Фото участника проекта 2'),
    ('agct-portrait-3.jpg', 'Фото участника проекта 3'),
    ('agct-portrait-4.jpg', 'Фото участника проекта 4'),
)


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
    previous = stage(db, 'AGCT-HIV', PREVIOUS_STAGE)
    target = stage(db, 'AGCT-HIV', TARGET_STAGE)
    stages = (source['id'], previous['id'], target['id'])
    video = db.execute('''SELECT * FROM evidence WHERE stage_id IN (?,?,?) AND title=? AND mime_type='video/mp4' ''',
                       (*stages, VIDEO_TITLE)).fetchall()
    if len(video) != 1:
        raise ValueError('Видео отсутствует или найдено несколько копий. Изменения не внесены.')
    photos = []
    for filename, title in PHOTOS:
        rows = db.execute('''SELECT * FROM evidence WHERE stage_id IN (?,?) AND title=? AND mime_type='image/jpeg' ''',
                          (previous['id'], target['id'], title)).fetchall()
        if len(rows) > 1:
            raise ValueError(f'Найдено несколько копий фото «{title}». Изменения не внесены.')
        if not rows and not (ASSETS / filename).is_file():
            raise ValueError(f'Фотография {filename} отсутствует в seed_assets.')
        if rows:
            key = rows[0]['storage_key']
            if not key.startswith('file:') or not (UPLOADS / key[5:]).is_file():
                raise ValueError(f'Файл фотографии «{title}» не найден в хранилище.')
        photos.append(rows[0] if rows else None)
    key = video[0]['storage_key']
    if not key.startswith('file:') or not (UPLOADS / key[5:]).is_file():
        raise ValueError('Файл видео не найден в хранилище. Изменения не внесены.')
    result = {'from': 'GLUTEN-FREE-YEAST / ' + SOURCE_STAGE,
              'to': 'AGCT-HIV / ' + TARGET_STAGE,
              'video_moved': video[0]['stage_id'] != target['id'],
              'photos_moved': sum(row is not None and row['stage_id'] != target['id'] for row in photos),
              'photos_added': sum(row is None for row in photos), 'applied': False}
    if apply and (result['video_moved'] or result['photos_moved'] or result['photos_added']):
        with transaction(db):
            if result['video_moved']:
                db.execute('UPDATE evidence SET stage_id=? WHERE id=?', (target['id'], video[0]['id']))
            for (filename,title),row in zip(PHOTOS, photos):
                if row and row['stage_id'] != target['id']:
                    db.execute('UPDATE evidence SET stage_id=? WHERE id=?', (target['id'], row['id']))
                elif row is None:
                    add_material(db, target['id'], target['founder_id'], filename, title, 'image/jpeg')
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
