#!/usr/bin/env bash
# Перенос PostgreSQL: дамп из старого хоста (Neon) → восстановление в новый.
#
# Нужны локально: pg_dump, pg_restore, psql (PostgreSQL client 14+).
#
# 1) Экспорт (кастомный формат, удобно для pg_restore):
#    export PG_SOURCE='postgresql://USER:PASS@OLD-HOST/dbname?sslmode=require'
#    ./scripts/pg-dump-restore-migrate.sh dump
#    → файл survey-app/pg-migrate-backup.dump рядом с репозиторием (в .gitignore добавьте *.dump)
#
# 2) Импорт в новую БД (создайте пустую БД и пользователя в панели нового провайдера):
#    export PG_TARGET='postgresql://USER:PASS@NEW-HOST/dbname?sslmode=require'
#    ./scripts/pg-dump-restore-migrate.sh restore
#
# 3) В Yandex Cloud Function обновите переменную PG_CONNECTION_STRING на PG_TARGET и задеплойте версию.
#
# Примечания:
# - Для Supabase строка подключения в Project Settings → Database (режим «URI», пароль — database password).
# - Для Yandex Managed PostgreSQL — хост кластера, порт 6432 часто для пулера; sslmode=require.
# - Если restore ругается на роли: используйте --no-owner в restore (ниже включено).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="$ROOT/pg-migrate-backup.dump"

cmd="${1:-}"

if [[ "$cmd" == "dump" ]]; then
  if [[ -z "${PG_SOURCE:-}" ]]; then
    echo "Задайте PG_SOURCE=postgresql://..." >&2
    exit 1
  fi
  echo ">>> pg_dump → $DUMP"
  pg_dump --format=custom --blobs --verbose --file="$DUMP" "$PG_SOURCE"
  echo ">>> Готово. Перенесите файл в безопасное место и выполните restore на новом хосте."
  exit 0
fi

if [[ "$cmd" == "restore" ]]; then
  if [[ -z "${PG_TARGET:-}" ]]; then
    echo "Задайте PG_TARGET=postgresql://..." >&2
    exit 1
  fi
  if [[ ! -f "$DUMP" ]]; then
    echo "Нет файла $DUMP — сначала: PG_SOURCE=... $0 dump" >&2
    exit 1
  fi
  echo ">>> pg_restore → новая БД"
  pg_restore --verbose --no-owner --no-acl --clean --if-exists --dbname="$PG_TARGET" "$DUMP"
  echo ">>> Готово. Проверьте приложение и обновите PG_CONNECTION_STRING в функции."
  exit 0
fi

cat <<'EOF'
Использование:
  PG_SOURCE='postgresql://...' ./scripts/pg-dump-restore-migrate.sh dump
  PG_TARGET='postgresql://...' ./scripts/pg-dump-restore-migrate.sh restore
EOF
exit 1
