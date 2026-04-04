#!/usr/bin/env bash
# Дамп PostgreSQL БЕЗ таблицы photo_wall_uploads (там base64 и основной вес трафика).
# Остальное — опросы, ответы, пользователи, workbook, приглашения и т.д.
#
# Использование:
#   cd /path/to/audio/survey-app
#   export PG_SOURCE='postgresql://USER:PASS@ep-xxx.neon.tech/neondb?sslmode=require'
#   ./scripts/pg-dump-without-photo-wall.sh
#   → файл survey-app/pg-migrate-no-photo.dump (custom format)
#
# Восстановление в новой БД (пустой инстанс Neon после создания БД):
#   export PG_TARGET='postgresql://...'
#   pg_restore --verbose --no-owner --no-acl --clean --if-exists --dbname="$PG_TARGET" pg-migrate-no-photo.dump
#
# После restore на новом Neon выполните миграции для фотостены (009–012), если таблицы ещё нет — или schema.sql.
#
# Если Neon отключает подключение из‑за квоты — см. docs/NEON_TRAFFIC_AND_MIGRATION.md (обходы).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/pg-migrate-no-photo.dump"

if [[ -z "${PG_SOURCE:-}" ]]; then
  echo "Задайте PG_SOURCE=postgresql://..." >&2
  exit 1
fi

echo ">>> pg_dump (без photo_wall_uploads) → $OUT"
pg_dump \
  --format=custom \
  --blobs \
  --verbose \
  --exclude-table=photo_wall_uploads \
  --file="$OUT" \
  "$PG_SOURCE"

echo ">>> Готово. Размер:"
ls -lh "$OUT"
