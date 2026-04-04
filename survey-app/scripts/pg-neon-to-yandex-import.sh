#!/usr/bin/env bash
# Импорт базы Neon → Yandex Managed PostgreSQL (с вашего Mac / Linux с установленным клиентом PostgreSQL).
#
# Перед запуском:
# 1) В Neon: строка подключения **без pooler** (direct / unpooled) — иначе pg_dump может падать.
#    В Dashboard → Connect → выберите режим без "-pooler" в хосте, если есть.
# 2) В Yandex: Managed PostgreSQL → кластер → получите FQDN хоста, порт (часто 6432 для пулера или 5432),
#    пользователя и пароль. Строка вида:
#    postgresql://user:password@rc1a-xxxxx.mdb.yandexcloud.net:6432/dbname?sslmode=require
# 3) Если Neon режет квоту — импорт не пройдёт, пока не сбросится лимит или не поднимется тариф;
#    тогда выгрузите без тяжёлой таблицы: EXCLUDE_PHOTO_WALL=1 ./scripts/pg-neon-to-yandex-import.sh
#
# Использование:
#   export PG_SOURCE='postgresql://USER:PASS@ep-xxx.neon.tech/neondb?sslmode=require'
#   export PG_TARGET='postgresql://USER:PASS@rc1a-....mdb.yandexcloud.net:6432/db?sslmode=require'
#   ./scripts/pg-neon-to-yandex-import.sh
#
# Только опросы, без photo_wall_uploads (меньше данных и трафика):
#   EXCLUDE_PHOTO_WALL=1 ./scripts/pg-neon-to-yandex-import.sh
#
# После импорта в Cloud Function задайте PG_CONNECTION_STRING = PG_TARGET (и при необходимости
# PG_SSL_REJECT_UNAUTHORIZED=false, если функция ругается на сертификат — см. BACKEND_AND_API.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="$ROOT/pg-neon-to-yandex-temp.dump"

if [[ -z "${PG_SOURCE:-}" || -z "${PG_TARGET:-}" ]]; then
  echo "Нужны обе переменные: PG_SOURCE (Neon) и PG_TARGET (Yandex)." >&2
  exit 1
fi

DUMP_ARGS=(--format=custom --blobs --verbose --file="$DUMP")
if [[ "${EXCLUDE_PHOTO_WALL:-}" == "1" ]]; then
  DUMP_ARGS+=(--exclude-table=photo_wall_uploads)
  echo ">>> Режим: без таблицы photo_wall_uploads"
fi
DUMP_ARGS+=("$PG_SOURCE")

rm -f "$DUMP"

echo ">>> pg_dump (Neon) → временный файл…"
pg_dump "${DUMP_ARGS[@]}"

echo ">>> pg_restore → Yandex Managed PostgreSQL…"
pg_restore --verbose --no-owner --no-acl --clean --if-exists --dbname="$PG_TARGET" "$DUMP"

rm -f "$DUMP"
echo ">>> Готово. Проверьте данные в Yandex и обновите PG_CONNECTION_STRING в Cloud Function."
