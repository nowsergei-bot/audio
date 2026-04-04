#!/usr/bin/env bash
# Перенос базы: старый Neon → новый проект/аккаунт Neon (одна команда из терминала).
#
# Установите локально клиент PostgreSQL (pg_dump, pg_restore). На macOS: brew install libpq
#
# Перед запуском:
# - В НОВОМ Neon создайте проект и БД (имя часто neondb).
# - В обоих проектах возьмите строку Connect → **без pooler** (direct / unpooled), если pg_dump ругается.
# - В конце URI добавьте ?sslmode=require если его нет.
#
# Полный перенос (включая фотостену):
#   cd /path/to/audio/survey-app
#   export PG_SOURCE='postgresql://USER:PASS@ep-СТАРЫЙ.neon.tech/neondb?sslmode=require'
#   export PG_TARGET='postgresql://USER:PASS@ep-НОВЫЙ.neon.tech/neondb?sslmode=require'
#   ./scripts/pg-neon-to-neon-migrate.sh
#
# Без таблицы photo_wall_uploads (легче по трафику и размеру):
#   EXCLUDE_PHOTO_WALL=1 ./scripts/pg-neon-to-neon-migrate.sh
#
# После успеха: в Yandex Cloud Function укажите PG_CONNECTION_STRING = PG_TARGET и задеплойте версию.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="$ROOT/pg-neon-migrate.dump"

if [[ -z "${PG_SOURCE:-}" || -z "${PG_TARGET:-}" ]]; then
  echo "Задайте обе переменные:" >&2
  echo "  export PG_SOURCE='postgresql://…старый Neon…'" >&2
  echo "  export PG_TARGET='postgresql://…новый Neon…'" >&2
  exit 1
fi

DUMP_ARGS=(--format=custom --blobs --verbose --file="$DUMP")
if [[ "${EXCLUDE_PHOTO_WALL:-}" == "1" ]]; then
  DUMP_ARGS+=(--exclude-table=photo_wall_uploads)
  echo ">>> Режим: без таблицы photo_wall_uploads"
fi
DUMP_ARGS+=("$PG_SOURCE")

rm -f "$DUMP"

echo ">>> pg_dump ← старый Neon…"
pg_dump "${DUMP_ARGS[@]}"

echo ">>> pg_restore → новый Neon…"
pg_restore --verbose --no-owner --no-acl --clean --if-exists --dbname="$PG_TARGET" "$DUMP"

rm -f "$DUMP"
echo ">>> Готово. Обновите PG_CONNECTION_STRING в Cloud Function на строку нового Neon."
