from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get("BOKOBOK_DB_PATH", ROOT / "data" / "bokobok.db"))
MIGRATIONS = ROOT / "db" / "migrations"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def public_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    rounds = 310_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
    return f"pbkdf2_sha256${rounds}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def connect(path: Path | None = None) -> sqlite3.Connection:
    target = path or DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target, timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


@contextmanager
def transaction(connection: sqlite3.Connection):
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
        connection.execute("COMMIT")
    except Exception:
        connection.execute("ROLLBACK")
        raise


def migrate(connection: sqlite3.Connection) -> None:
    connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
    applied = {row[0] for row in connection.execute("SELECT version FROM schema_migrations")}
    for file in sorted(MIGRATIONS.glob("[0-9]*_*.sql")):
        prefix = file.stem.split("_", 1)[0]
        if not prefix.isdecimal():
            continue
        version = int(prefix)
        if version in applied:
            continue
        script = file.read_text(encoding="utf-8")
        try:
            connection.executescript("BEGIN IMMEDIATE;\n" + script)
            connection.execute("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",(version,file.name,utc_now()))
            connection.execute('COMMIT')
        except Exception:
            if connection.in_transaction: connection.execute('ROLLBACK')
            raise


def seed(connection: sqlite3.Connection) -> None:
    """Create reference data only. Product and user data must come from real input."""
    roles = [(1,"investor","Инвестор"),(2,"founder","Основатель проекта"),(3,"fund_staff","Сотрудник фонда"),(4,"super_admin","Главный администратор")]
    with transaction(connection):
        connection.executemany("INSERT OR IGNORE INTO roles(id,code,name) VALUES(?,?,?)", roles)


def init_database(path: Path | None = None) -> Path:
    target = path or DB_PATH
    connection = connect(target)
    try:
        migrate(connection)
        seed(connection)
        problems = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if problems != "ok":
            raise RuntimeError(f"Database integrity check failed: {problems}")
    finally:
        connection.close()
    return target


if __name__ == "__main__":
    print(init_database())
