#!/bin/sh
set -eu
umask 077

backup_dir="${BACKUP_DIR:-/opt/bokobok/backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
temp_file="$backup_dir/.bokobok-$stamp-$$.tmp"
backup_file="$backup_dir/bokobok-$stamp.db"
temp_uploads="$backup_dir/.bokobok-uploads-$stamp-$$.tmp"
uploads_file="$backup_dir/bokobok-uploads-$stamp.tar.gz"

cleanup() {
  rm -f "$temp_file" "$temp_uploads"
  docker compose exec -T app rm -f /data/.bokobok-backup.db /data/.bokobok-uploads.tar.gz >/dev/null 2>&1 || true
}
trap cleanup 0
trap 'exit 1' 1 2 3 15

docker compose exec -T app python -c "import sqlite3; src=sqlite3.connect('/data/bokobok.db'); dst=sqlite3.connect('/data/.bokobok-backup.db'); src.backup(dst); dst.close(); src.close()"
docker compose cp app:/data/.bokobok-backup.db "$temp_file"
python3 - "$temp_file" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1])
with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Backup failed SQLite integrity check')
PY
docker compose exec -T app sh -c 'mkdir -p /data/uploads && tar -C /data -czf /data/.bokobok-uploads.tar.gz uploads'
docker compose cp app:/data/.bokobok-uploads.tar.gz "$temp_uploads"
tar -tzf "$temp_uploads" >/dev/null
mv "$temp_file" "$backup_file"
mv "$temp_uploads" "$uploads_file"
find "$backup_dir" -type f -name 'bokobok-*.db' -mtime +14 -delete
find "$backup_dir" -type f -name 'bokobok-uploads-*.tar.gz' -mtime +14 -delete

echo "Backup created and verified: $backup_file and $uploads_file"
