"""Create one isolated demonstration founder and a six-event research project.

Run from the repository root: python3 -B backend/seed_demo.py
The generated password is printed once and never stored in plaintext.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from pathlib import Path

from db import DB_PATH, connect, hash_password, init_database, public_id, transaction, utc_now

EMAIL = "demo.founder@bokobok.test"
CODE = "DEMO-KUMA30"

# Fictional example content: it must never be presented as actual research progress.
STAGES = [
    ("Гипотеза и научная база", "Сформулировать принцип платформы и критерии успеха.", "completed", 100, "2024-03-15", None, 1),
    ("Проверка исходной культуры", "Зафиксировать исходные свойства и воспроизводимость культуры.", "completed", 100, "2025-03-20", 1, 2),
    ("Пищевой штамм", "Интегрировать конструкцию в пищевой штамм и подтвердить экспрессию без маркера.", "in_progress", 58, "2026-10-15", 2, 4),
    ("Стабильность экспрессии", "Проверить сохранение экспрессии в повторных циклах.", "in_progress", 42, "2026-11-30", 2, 4),
    ("Валидация технологии", "Подтвердить результат на расширенной серии.", "planned", 0, "2027-06-30", 3, 6),
    ("Пилотная партия", "Проверить перенос процесса на пилотный объём.", "planned", 0, "2027-11-15", 5, 7),
]
DEMO_STAGE_COUNT = len(STAGES)


def create_demo(path: Path | None = None, password: str | None = None) -> dict:
    target = path or DB_PATH
    init_database(target)
    db = connect(target)
    try:
        with transaction(db):
            existing = db.execute("SELECT public_id FROM users WHERE email=?", (EMAIL,)).fetchone()
            project = db.execute("SELECT public_id FROM projects WHERE code=?", (CODE,)).fetchone()
            if existing or project:
                if not (existing and project):
                    raise RuntimeError("Демоданные частично существуют; автоматическое перезаписывание запрещено.")
                return {"user_id": existing["public_id"], "project_id": project["public_id"], "created": False}

            password = password or secrets.token_urlsafe(18)
            if len(password) < 12:
                raise ValueError("Демонстрационный пароль должен содержать минимум 12 символов.")
            user_public_id = public_id("usr")
            cursor = db.execute(
                "INSERT INTO users(public_id,role_id,full_name,email,organization,password_hash,status,two_factor_enabled) "
                "VALUES(?,(SELECT id FROM roles WHERE code='founder'),?,?,?,?,'active',0)",
                (user_public_id, "Мария Соколова · демо", EMAIL, "Демонстрационная лаборатория", hash_password(password)),
            )
            user_id = cursor.lastrowid
            project_public_id = public_id("prj")
            summary = f"Демонстрационный проект с {DEMO_STAGE_COUNT} событиями, ветвлением и шкалой УГТ. Все сведения вымышлены."
            cursor = db.execute(
                "INSERT INTO projects(public_id,code,slug,name,summary,description,field,region,status,ugt_level,founder_id) "
                "VALUES(?,?,?,?,?,?,?,?,'draft',5,?)",
                (project_public_id, CODE, "demo-kuma30", "KUMA30 · демонстрационный проект", summary,
                 "Учебный пример для проверки интерфейса «Бок о бок». Статусы, даты, результаты и материалы не относятся к реальному исследованию.",
                 "Биотехнологии", "Россия", user_id),
            )
            project_id = cursor.lastrowid
            db.execute("INSERT INTO project_members(project_id,user_id,member_role) VALUES(?,?,'owner')", (project_id, user_id))
            version_public_id = public_id("tree")
            cursor = db.execute(
                "INSERT INTO tree_versions(public_id,project_id,version_number,state,change_summary,created_by,card_json) "
                "VALUES(?,?,1,'draft',?,?,?)",
                (version_public_id, project_id, f"Демонстрационное дерево из {DEMO_STAGE_COUNT} событий", user_id,
                 json.dumps({"name": "KUMA30 · демонстрационный проект", "summary": summary, "status": "draft"}, ensure_ascii=False)),
            )
            tree_id = cursor.lastrowid
            stage_ids = {}
            for position, (title, description, status, progress, date, parent, ugt) in enumerate(STAGES, 1):
                criteria = "[x] План этапа согласован\n[x] Методика зафиксирована\n[ ] Повторная проверка завершена"
                if status == "completed":
                    criteria = criteria.replace("[ ]", "[x]")
                elif status == "planned":
                    criteria = criteria.replace("[x]", "[ ]")
                note = "Ожидается повторная серия измерений." if position in (3, 4) else ""
                stage_public_id = public_id("stg")
                cursor = db.execute(
                    "INSERT INTO stages(public_id,tree_version_id,parent_stage_id,position,branch_code,title,description,criteria_text,attention_note,status,progress,ugt_level,owner_id,due_at,completed_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (stage_public_id, tree_id, stage_ids.get(parent), position, "branch" if parent else "main",
                     title, description, criteria, note, status, progress, ugt, user_id, date,
                     date if status == "completed" else None),
                )
                stage_ids[position] = cursor.lastrowid

            for position, title, body in (
                (3, "Протокол исследования.txt", "ДЕМО. Пример структуры протокола для события «Пищевой штамм». Реальных результатов нет."),
                (3, "Журнал проверок.txt", "ДЕМО. Повторная серия ещё не завершена; данные приведены только для интерфейса."),
                (5, "План валидации.txt", "ДЕМО. Критерии и сроки валидации являются вымышленными."),
            ):
                raw = body.encode("utf-8")
                db.execute(
                    "INSERT INTO evidence(public_id,stage_id,title,storage_key,mime_type,byte_size,checksum_sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?)",
                    (public_id("doc"), stage_ids[position], title, "base64:" + base64.b64encode(raw).decode(),
                     "text/plain", len(raw), hashlib.sha256(raw).hexdigest(), user_id),
                )
            db.execute(
                "INSERT INTO audit_log(public_id,actor_id,action,entity_type,entity_public_id,metadata_json,created_at) "
                "VALUES(?,?,'demo.created','project',?,?,?)",
                (public_id("aud"), user_id, project_public_id, json.dumps({"stages": DEMO_STAGE_COUNT}), utc_now()),
            )
        return {"user_id": user_public_id, "project_id": project_public_id, "created": True, "email": EMAIL, "password": password}
    finally:
        db.close()


if __name__ == "__main__":
    print(json.dumps(create_demo(), ensure_ascii=False))
