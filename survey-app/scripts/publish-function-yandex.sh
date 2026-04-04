#!/usr/bin/env bash
# Сборка ZIP и (опционально) создание новой версии функции в Yandex Cloud через yc.
#
# Только собрать ZIP:
#   ./scripts/publish-function-yandex.sh
#
# Собрать ZIP и залить (yc config set folder-id …, залогиньтесь: yc init):
#   export PG_CONNECTION_STRING='postgresql://...' ADMIN_API_KEY='...' CORS_ORIGIN='https://…'
#   YC_FUNCTION_NAME=survey-api ./scripts/publish-function-yandex.sh publish
#
# Только залить уже готовый backend/function-bundle.zip (без npm/zip):
#   export PG_CONNECTION_STRING='…' ADMIN_API_KEY='…' CORS_ORIGIN='https://…'
#   YC_FUNCTION_NAME=survey-api ./scripts/publish-function-yandex.sh upload
#   Другой файл: ZIP_PATH=/path/to/bundle.zip ./scripts/publish-function-yandex.sh upload
#
# Имя функции по умолчанию: survey-api. Другое: YC_FUNCTION_NAME=моя-функция
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="${ZIP_PATH:-$ROOT/backend/function-bundle.zip}"
NAME="${YC_FUNCTION_NAME:-survey-api}"
RUNTIME="${YC_FUNCTION_RUNTIME:-nodejs18}"
MEMORY="${YC_FUNCTION_MEMORY:-256MB}"
TIMEOUT="${YC_FUNCTION_TIMEOUT:-30s}"

CMD="${1:-}"

if [[ "$CMD" == "help" || "$CMD" == "-h" ]]; then
  echo ""
  echo "Архив по умолчанию: $ZIP"
  echo "  ./scripts/publish-function-yandex.sh           — только собрать ZIP"
  echo "  … publish                                      — собрать и yc serverless function version create"
  echo "  … upload                                       — только залить готовый ZIP (переменные см. в шапке файла)"
  exit 0
fi

if [[ "$CMD" == "publish" ]]; then
  "$ROOT/scripts/deploy-functions.sh"
elif [[ "$CMD" == "upload" ]]; then
  if [[ ! -f "$ZIP" ]]; then
    echo "Нет архива: $ZIP" >&2
    echo "Соберите: ./scripts/deploy-functions.sh  или  ./scripts/publish-function-yandex.sh" >&2
    exit 1
  fi
elif [[ -z "$CMD" ]]; then
  "$ROOT/scripts/deploy-functions.sh"
  echo ""
  echo "Архив: $ZIP"
  echo "Залить в Yandex Cloud: export PG_CONNECTION_STRING='…' ADMIN_API_KEY='…' CORS_ORIGIN='https://…'"
  echo "  YC_FUNCTION_NAME=$NAME $ROOT/scripts/publish-function-yandex.sh upload"
  echo "  или: $ROOT/scripts/upload-function-zip-yandex.sh"
  exit 0
else
  echo "Неизвестная команда: $CMD. См.: ./scripts/publish-function-yandex.sh help" >&2
  exit 1
fi

if ! command -v yc >/dev/null 2>&1; then
  echo "yc не найден. Установите Yandex Cloud CLI." >&2
  exit 1
fi

# Собираем --environment KEY=VAL для yc (повторяющийся флаг надёжнее запятых в значениях)
env_args=()
for key in \
  PG_CONNECTION_STRING PG_POOL_MAX PG_SSL PG_SSL_REJECT_UNAUTHORIZED ADMIN_API_KEY CORS_ORIGIN \
  OPENAI_API_KEY OPENAI_MODEL OPENAI_BASE_URL \
  DEEPSEEK_API_KEY DEEPSEEK_MODEL LLM_PROVIDER \
  YANDEX_CLOUD_FOLDER_ID YANDEX_API_KEY YANDEX_IAM_TOKEN YANDEX_MODEL_URI \
  YC_FOLDER_ID YC_API_KEY YC_IAM_TOKEN \
  PHOTO_WALL_BUCKET S3_BUCKET YC_BUCKET PHOTO_WALL_STORAGE PHOTO_WALL_PUBLIC_BASE_URL \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION S3_ENDPOINT \
  PHOTO_WALL_OBJECT_ACL_PUBLIC_READ YC_OBJECT_ACL_PUBLIC_READ \
  PUBLIC_APP_BASE SESSION_TTL_DAYS CORP_EMAIL_DOMAINS \
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM SMTP_SECURE; do
  val="${!key:-}"
  if [[ -n "$val" ]]; then
    env_args+=(--environment "${key}=${val}")
  fi
done

if [[ ${#env_args[@]} -eq 0 ]]; then
  echo "Ошибка: задайте переменные окружения (минимум PG_CONNECTION_STRING, ADMIN_API_KEY, CORS_ORIGIN)." >&2
  echo "Либо загрузите вручную в консоли Yandex Cloud: $ZIP" >&2
  exit 1
fi

echo ">>> yc serverless function version create --function-name $NAME ..."
yc serverless function version create \
  --function-name "$NAME" \
  --runtime "$RUNTIME" \
  --entrypoint index.handler \
  --memory "$MEMORY" \
  --execution-timeout "$TIMEOUT" \
  --source-path "$ZIP" \
  "${env_args[@]}"

echo ">>> Готово."
