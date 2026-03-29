#!/usr/bin/env bash
# Удобная обёртка для выкладки статики Пульса в Yandex Object Storage.
# Пошаговый сценарий в корне проекта: DEPLOY_STEPS.md
#
# Использование:
#   ./scripts/deploy-static-site.sh              # справка + список шагов
#   ./scripts/deploy-static-site.sh status       # проверка окружения (без ключей в выводе)
#   ./scripts/deploy-static-site.sh build        # только сборка frontend → dist
#   ./scripts/deploy-static-site.sh sync         # только заливка (нужны ключи и dist)
#   ./scripts/deploy-static-site.sh all          # npm ci + build + sync (чистая установка)
#   ./scripts/deploy-static-site.sh quick|q    # быстро: npm run build + sync (без npm ci)
#
# Переменные (для sync / all):
#   YC_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   AWS_DEFAULT_REGION (по умолчанию ru-central1)
#   YC_OBJECT_ACL_PUBLIC_READ=1  — если нет публичной политики бакета
#
# Сборка:
#   Поле apiBase в deploy.config.json (или .youware.json), или frontend/.env.production, или VITE_API_BASE в env

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/frontend/dist"

# Видимый файл в репозитории; опционально — скрытый .youware.json (расширение YouWare)
deploy_config_path() {
  if [[ -f "$ROOT/deploy.config.json" ]]; then
    echo "$ROOT/deploy.config.json"
  elif [[ -f "$ROOT/.youware.json" ]]; then
    echo "$ROOT/.youware.json"
  else
    echo ""
  fi
}

bucket_from_config() {
  local p
  p="$(deploy_config_path)"
  if [[ -n "$p" ]] && command -v node >/dev/null 2>&1; then
    node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(j.bucket||''));" "$p" 2>/dev/null || true
  else
    echo ""
  fi
}

api_base_from_config() {
  local p
  p="$(deploy_config_path)"
  if [[ -n "$p" ]] && command -v node >/dev/null 2>&1; then
    node -e "try{const j=require(process.argv[1]);const b=String(j.apiBase||'').trim();if(b)process.stdout.write(b);}catch(e){}" "$p" 2>/dev/null || true
  else
    echo ""
  fi
}

ensure_prod_api_base() {
  if [[ -n "${VITE_API_BASE:-}" ]]; then
    echo ">>> VITE_API_BASE из окружения" >&2
    return 0
  fi
  local from_cfg
  from_cfg="$(api_base_from_config)"
  if [[ -n "$from_cfg" ]]; then
    export VITE_API_BASE="$from_cfg"
    echo ">>> VITE_API_BASE из $(basename "$(deploy_config_path)") (apiBase)" >&2
    return 0
  fi
  local ep="$ROOT/frontend/.env.production"
  if [[ -f "$ep" ]] && grep -qE '^[[:space:]]*VITE_API_BASE[[:space:]]*=[[:space:]]*[^#[:space:]]' "$ep"; then
    echo ">>> VITE_API_BASE из frontend/.env.production (подхватит Vite)" >&2
    return 0
  fi
  echo "Ошибка: для продакшен-сборки нужен URL API (иначе запросы пойдут на хостинг статики и вернут HTML)." >&2
  echo "  Задайте одно из:" >&2
  echo "  • survey-app/deploy.config.json → \"apiBase\": \"https://…\" (шлюз или функция)," >&2
  echo "  • frontend/.env.production с VITE_API_BASE=https://… (шаблон: .env.production.example)," >&2
  echo "  • или: VITE_API_BASE=https://… $0 build" >&2
  exit 1
}

# full=1 — всегда npm ci/install; full=0 — только npm run build, если есть node_modules
do_frontend_build() {
  local full="${1:-1}"
  ensure_prod_api_base
  cd "$ROOT/frontend"
  if [[ "$full" == "1" ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  else
    if [[ ! -d node_modules ]]; then
      echo ">>> Нет frontend/node_modules — выполняю npm install (один раз)" >&2
      if [[ -f package-lock.json ]]; then
        npm ci
      else
        npm install
      fi
    else
      echo ">>> Быстрая сборка: без npm ci (только vite build)" >&2
    fi
  fi
  npm run build
  echo ">>> Сборка готова: $DIST"
}

cmd="${1:-help}"

case "$cmd" in
  help|--help|-h|"")
    cat <<'EOF'
Пульс — выкладка статического сайта (Object Storage)

Команды:
  status     Проверить Node, npm, aws, dist, бакет и apiBase из deploy.config.json
  build      Собрать frontend (npm ci или npm install)
  sync       Залить frontend/dist в бакет (aws s3 sync)
  all        полная сборка (npm ci) + sync
  quick / q  быстрая выкладка: только npm run build + sync (удобно для повторных заливок)
  url        Показать ожидаемый URL сайта по имени бакета

Переменные для sync:
  export YC_BUCKET=имя-бакета          # или из deploy.config.json / .youware.json
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...
  export AWS_DEFAULT_REGION=ru-central1   # опционально
  export YC_OBJECT_ACL_PUBLIC_READ=1      # если нужен ACL на объекты

Сборка с API:
  Заполните apiBase в survey-app/deploy.config.json или frontend/.env.production, либо:
  VITE_API_BASE='https://...' ./scripts/deploy-static-site.sh build

Пошаговая инструкция (облако, бакет, ключи): DEPLOY_STEPS.md и OBJECT_STORAGE.md в корне survey-app.

Шаги 1–12 — в DEPLOY_STEPS.md; после каждого можно написать «Шаг N сделан».
EOF
    ;;
  url)
    B="${YC_BUCKET:-$(bucket_from_config)}"
    if [[ -z "$B" ]]; then
      echo "Задайте YC_BUCKET или заполните bucket в deploy.config.json" >&2
      exit 1
    fi
    echo "https://${B}.website.yandexcloud.net/"
    ;;
  status|check)
    echo ">>> Корень проекта: $ROOT"
    echo -n ">>> Node: "
    command -v node >/dev/null && node --version || { echo "не найден"; }
    echo -n ">>> npm: "
    command -v npm >/dev/null && npm --version || { echo "не найден"; }
    echo -n ">>> aws: "
    if command -v aws >/dev/null; then
      aws --version
    else
      echo "не найден (нужен для sync): brew install awscli"
    fi
    CFG_BUCKET="$(bucket_from_config)"
    CFG_API="$(api_base_from_config)"
    DC="$(deploy_config_path)"
    echo ">>> Файл настроек: ${DC:-нет — создайте survey-app/deploy.config.json}"
    echo ">>> Бакет из конфига: ${CFG_BUCKET:-—}"
    echo ">>> apiBase из конфига: ${CFG_API:-— (пусто — вставьте URL шлюза/функции)}"
    if [[ -f "$ROOT/frontend/.env.production" ]]; then
      echo ">>> frontend/.env.production: есть"
    else
      echo ">>> frontend/.env.production: нет (опционально; см. .env.production.example)"
    fi
    echo ">>> YC_BUCKET в окружении: ${YC_BUCKET:-—}"
    echo ">>> AWS_ACCESS_KEY_ID (env): ${AWS_ACCESS_KEY_ID:+задан}${AWS_ACCESS_KEY_ID:-— (можно профиль aws-cli)}"
    echo ">>> AWS_SECRET_ACCESS_KEY (env): ${AWS_SECRET_ACCESS_KEY:+задан}${AWS_SECRET_ACCESS_KEY:-—}"
    if [[ -d "$DIST" ]]; then
      N="$(find "$DIST" -type f 2>/dev/null | wc -l | tr -d ' ')"
      echo ">>> frontend/dist: есть ($N файлов)"
    else
      echo ">>> frontend/dist: нет — выполните: ./scripts/deploy-static-site.sh build"
    fi
    ;;
  build)
    do_frontend_build 1
    ;;
  quick|fast|q)
    do_frontend_build 0
    export YC_BUCKET="${YC_BUCKET:-$(bucket_from_config)}"
    if [[ -z "$YC_BUCKET" ]]; then
      echo "Задайте YC_BUCKET=... или bucket в survey-app/deploy.config.json" >&2
      exit 1
    fi
    "$ROOT/scripts/sync-object-storage.sh"
    echo ">>> Быстрая выкладка завершена."
    ;;
  sync|upload)
    export YC_BUCKET="${YC_BUCKET:-$(bucket_from_config)}"
    if [[ -z "$YC_BUCKET" ]]; then
      echo "Задайте YC_BUCKET=... или bucket в survey-app/deploy.config.json" >&2
      exit 1
    fi
    "$ROOT/scripts/sync-object-storage.sh"
    ;;
  all|deploy)
    do_frontend_build 1
    export YC_BUCKET="${YC_BUCKET:-$(bucket_from_config)}"
    if [[ -z "$YC_BUCKET" ]]; then
      echo "Задайте YC_BUCKET=... или bucket в survey-app/deploy.config.json" >&2
      exit 1
    fi
    "$ROOT/scripts/sync-object-storage.sh"
    echo ">>> Полная выкладка завершена."
    ;;
  *)
    echo "Неизвестная команда: $cmd. См. $0 help" >&2
    exit 1
    ;;
esac
