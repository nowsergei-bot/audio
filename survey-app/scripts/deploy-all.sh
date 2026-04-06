#!/usr/bin/env bash
# Пульс — одна точка входа для выкладки. Справка: ./scripts/deploy-all.sh help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cmd="${1:-help}"

case "$cmd" in
  help|--help|-h|'')
    cat <<'EOF'
Пульс — deploy-all.sh: статика и/или Cloud Function

  static   — vite build + заливка в бакет (как deploy-static-site.sh quick)
  bundle   — только собрать backend/function-bundle.zip
  function — zip + yc serverless function version create (нужны export’ы ниже)
  all      — static, затем function

Перед function / all задайте (в той же оболочке):
  export PG_CONNECTION_STRING='postgresql://…'
  export ADMIN_API_KEY='…'
  export CORS_ORIGIN='https://…website.yandexcloud.net'
  # опционально: OPENAI_API_KEY OPENAI_MODEL …

Пример:
  cd survey-app && ./scripts/deploy-all.sh all
EOF
    ;;
  static|s|site)
    exec "$ROOT/scripts/deploy-static-site.sh" quick
    ;;
  bundle|zip)
    exec "$ROOT/scripts/deploy-functions.sh"
    ;;
  function|f|api)
    exec "$ROOT/scripts/publish-function-yandex.sh" publish
    ;;
  all|a|deploy)
    "$ROOT/scripts/deploy-static-site.sh" quick
    echo ""
    echo ">>> Статика залита. Функция…"
    "$ROOT/scripts/publish-function-yandex.sh" publish
    ;;
  *)
    echo "Неизвестная команда: $cmd. Запустите: $0 help" >&2
    exit 1
    ;;
esac
