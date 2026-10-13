"""Delete one explicitly identified project after an external database/upload backup.

Preview: python backend/delete_project.py --code CODE --name-contains TEXT
Delete:  python backend/delete_project.py --code CODE --name-contains TEXT --apply
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from db import connect, public_id, transaction
from server import UPLOAD_ROOT


def delete_project(db, code: str, name_contains: str, upload_root: Path, apply: bool = False) -> dict:
    if not code.strip() or not name_contains.strip():
        raise ValueError('Укажите код и фрагмент названия проекта.')
    project = db.execute('SELECT id,public_id,code,name FROM projects WHERE code=?', (code.strip(),)).fetchone()
    if not project:
        raise ValueError(f'Проект с кодом «{code}» не найден. Ничего не удалено.')
    if name_contains.casefold() not in project['name'].casefold():
        raise ValueError(f'Название проекта не содержит «{name_contains}». Ничего не удалено.')
    counts = db.execute('''SELECT COUNT(DISTINCT s.id) stages,COUNT(DISTINCT e.id) materials
        FROM tree_versions v LEFT JOIN stages s ON s.tree_version_id=v.id
        LEFT JOIN evidence e ON e.stage_id=s.id WHERE v.project_id=?''', (project['id'],)).fetchone()
    keys = [row[0] for row in db.execute('''SELECT DISTINCT e.storage_key FROM evidence e
        JOIN stages s ON s.id=e.stage_id JOIN tree_versions v ON v.id=s.tree_version_id
        WHERE v.project_id=? AND e.storage_key LIKE 'file:%' ''', (project['id'],))]
    result = dict(public_id=project['public_id'], code=project['code'], name=project['name'],
                  stages=counts['stages'], materials=counts['materials'], applied=False)
    if not apply:
        return result
    with transaction(db):
        db.execute("DELETE FROM notifications WHERE entity_type='project' AND entity_public_id=?", (project['public_id'],))
        db.execute('DELETE FROM projects WHERE id=?', (project['id'],))
        db.execute('''INSERT INTO audit_log(public_id,action,entity_type,entity_public_id,metadata_json)
            VALUES(?,'project.deleted','project',?,?)''',
            (public_id('aud'), project['public_id'], json.dumps({'code': project['code'], 'name': project['name'],
                'stages': counts['stages'], 'materials': counts['materials']}, ensure_ascii=False)))
    root = upload_root.resolve()
    for key in keys:
        filename = key[5:]
        if not filename or filename != Path(filename).name:
            continue
        if db.execute('SELECT 1 FROM evidence WHERE storage_key=? LIMIT 1', (key,)).fetchone():
            continue
        target = (root / filename).resolve()
        if target.parent == root:
            target.unlink(missing_ok=True)
    result['applied'] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--code', required=True)
    parser.add_argument('--name-contains', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with connect() as db:
        try:
            result = delete_project(db, args.code, args.name_contains, UPLOAD_ROOT, args.apply)
        except ValueError as error:
            parser.exit(1, str(error) + '\n')
    print(json.dumps(result, ensure_ascii=False))
    if not args.apply:
        print('Проверка выполнена. Для удаления повторите команду с --apply после резервного копирования.')


if __name__ == '__main__':
    main()
