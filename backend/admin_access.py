"""List administrator logins or reset an administrator password interactively."""

from __future__ import annotations

import argparse
from contextlib import closing
from getpass import getpass

from db import connect, hash_password, init_database, transaction, utc_now


def main() -> None:
    parser = argparse.ArgumentParser(description="Доступ главного администратора «Бок о бок»")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--list", action="store_true", help="Показать email администраторов")
    action.add_argument("--reset", metavar="EMAIL", help="Задать новый пароль администратору")
    args = parser.parse_args()

    init_database()
    with closing(connect()) as db:
        if args.list:
            rows = db.execute("""
                SELECT u.email, u.full_name, u.status FROM users u
                JOIN roles r ON r.id = u.role_id
                WHERE r.code = 'super_admin' ORDER BY u.email
            """).fetchall()
            if not rows:
                print("Главный администратор ещё не создан.")
            for row in rows:
                print(f"{row['email']} · {row['full_name']} · {row['status']}")
            return

        email = args.reset.strip().lower()
        user = db.execute("""
            SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
            WHERE u.email = ? AND r.code = 'super_admin' AND u.status = 'active'
        """, (email,)).fetchone()
        if not user:
            parser.error("Активный администратор с таким email не найден.")
        password = getpass("Новый пароль (12–200 символов): ")
        if not 12 <= len(password) <= 200:
            parser.error("Пароль должен содержать от 12 до 200 символов.")
        if password != getpass("Повторите пароль: "):
            parser.error("Пароли не совпадают.")
        with transaction(db):
            db.execute("UPDATE users SET password_hash=?,updated_at=? WHERE id=?",
                       (hash_password(password), utc_now(), user['id']))
            db.execute("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
                       (utc_now(), user['id']))
        print(f"Пароль для {email} обновлён. Старые сеансы завершены.")


if __name__ == "__main__":
    main()
