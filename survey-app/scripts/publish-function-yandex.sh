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
# Архив > 3.5 МБ: Yandex не принимает --source-path; скрипт заливает ZIP в Object Storage и
# создаёт версию через package. Сначала пробуется yc storage s3 cp (после yc init — без AWS-ключей).
# Если не вышло — aws s3 cp (нужны корректные AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
# Только aws: YC_FUNCTION_ZIP_UPLOAD=aws
#
# Имя функции по умолчанию: survey-api. Другое: YC_FUNCTION_NAME=моя-функция
#
# Каталог (folder-id), где лежит функция — один из вариантов:
#   • поле "yandexFolderId" в survey-app/deploy.config.json (удобно для команды)
#   • yc config set folder-id b1g…
#   • export YC_FOLDER_ID=b1g…
# (id из URL консоли …/folders/b1g…/…)
# По id функции (Обзор в консоли), если по имени не находит:
#   export YC_FUNCTION_ID=d4e32dmq42lg8r2n24pj
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Имя / id функции из survey-app/deploy.config.json (если не заданы YC_FUNCTION_NAME / YC_FUNCTION_ID)
deploy_config_field() {
  local field="$1"
  local p="$ROOT/deploy.config.json"
  [[ -f "$p" ]] || return 0
  # Одна строка и одинарные кавычки — совместимость с bash 3.2 / macOS
  node -e 'const j=require(process.argv[1]);const k=process.argv[2];const r=j[k];let v="";if(typeof r==="string")v=r.trim();else if(r!=null)v=String(r).trim();if(v&&v!=="null")process.stdout.write(v);' "$p" "$field" 2>/dev/null || true
}

# Секреты не в репозитории: создайте survey-app/.env.cloud-function (шаблон: .env.cloud-function.example)
# с PG_CONNECTION_STRING, ADMIN_API_KEY, CORS_ORIGIN и при необходимости SMTP_* для почты.
# или задайте их в shell до запуска. Иначе: YC_FUNCTION_ENV_FILE=/path/to/file
_ENV_CF="${YC_FUNCTION_ENV_FILE:-$ROOT/.env.cloud-function}"
if [[ -f "$_ENV_CF" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$_ENV_CF"
  set +a
  echo ">>> Переменные окружения: загружен $_ENV_CF" >&2
fi
ZIP="${ZIP_PATH:-$ROOT/backend/function-bundle.zip}"
NAME="${YC_FUNCTION_NAME:-$(deploy_config_field yandexFunctionName)}"
NAME="${NAME:-survey-api}"
FUNC_ID="${YC_FUNCTION_ID:-$(deploy_config_field yandexFunctionId)}"
RUNTIME="${YC_FUNCTION_RUNTIME:-nodejs18}"
MEMORY="${YC_FUNCTION_MEMORY:-256MB}"
# Мульти-сводка (batch-analytics) + LLM: при 60s часто 504 у шлюза; по умолчанию 120s, при необходимости 180s
TIMEOUT="${YC_FUNCTION_TIMEOUT:-120s}"

CMD="${1:-}"

if [[ "$CMD" == "help" || "$CMD" == "-h" ]]; then
  echo ""
  echo "Архив по умолчанию: $ZIP"
  echo "  ./scripts/publish-function-yandex.sh           — только собрать ZIP"
  echo "  … publish                                      — собрать и yc serverless function version create"
  echo "  … upload                                       — только залить готовый ZIP (переменные см. в шапке файла)"
  echo ""
  echo "ZIP > 3.5 МБ: автоматически s3 cp в бакет + version create с package (нужны YC_BUCKET и AWS_*)."
  echo ""
  echo "Если yc пишет «can't resolve … without folder id» или «function … not found»:"
  echo "  1) Каталог должен совпадать с тем, где создана функция: yc config set folder-id b1g…"
  echo "     (или YC_FOLDER_ID / поле yandexFolderId в deploy.config.json)"
  echo "  2) Список функций в каталоге: yc serverless function list"
  echo "  3) Создать функцию survey-api (один раз):"
  echo "     yc serverless function create --name survey-api"
  echo "  4) Или укажите реальное имя: export YC_FUNCTION_NAME=имя-из-списка"
  echo "     либо в deploy.config.json: \"yandexFunctionName\": \"…\""
  echo "  5) Вместо имени — id из консоли (Обзор функции):"
  echo "     export YC_FUNCTION_ID=d4e32…  или \"yandexFunctionId\" в deploy.config.json"
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
  OPENAI_API_KEY OPENAI_MODEL OPENAI_MODEL_FALLBACKS LLM_MODEL_FALLBACKS OPENAI_BASE_URL \
  OPENROUTER_HTTP_REFERER OPENROUTER_TITLE OPENROUTER_APP_NAME \
  GIGACHAT_CREDENTIALS GIGACHAT_AUTHORIZATION_KEY GIGACHAT_CLIENT_ID GIGACHAT_CLIENT_SECRET \
  GIGACHAT_MODEL GIGACHAT_SCOPE GIGACHAT_OAUTH_URL GIGACHAT_CHAT_BASE_URL GIGACHAT_TLS_INSECURE LLM_PROVIDER \
  YANDEX_CLOUD_FOLDER_ID YANDEX_API_KEY YANDEX_IAM_TOKEN YANDEX_MODEL_URI \
  YC_FOLDER_ID YC_API_KEY YC_IAM_TOKEN \
  PHOTO_WALL_BUCKET S3_BUCKET YC_BUCKET PHOTO_WALL_STORAGE PHOTO_WALL_PUBLIC_BASE_URL \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION S3_ENDPOINT \
  PHOTO_WALL_OBJECT_ACL_PUBLIC_READ YC_OBJECT_ACL_PUBLIC_READ \
  PUBLIC_APP_BASE SESSION_TTL_DAYS CORP_EMAIL_DOMAINS \
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM SMTP_SECURE \
  SMTP_REQUIRE_TLS SMTP_TLS_REJECT_UNAUTHORIZED SMTP_CONNECTION_TIMEOUT_MS; do
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

# folder-id из deploy.config.json / .youware.json (поля yandexFolderId или folderId)
folder_id_from_deploy_config() {
  local p="$1"
  [[ -f "$p" ]] || return 1
  command -v node >/dev/null 2>&1 || return 1
  node -e "
    try {
      const j = require(process.argv[1]);
      const v = String(j.yandexFolderId || j.folderId || '').trim();
      if (v) process.stdout.write(v);
    } catch (e) {}
  " "$p" 2>/dev/null || true
}

bucket_from_deploy_config() {
  local p="$1"
  [[ -f "$p" ]] || return 1
  command -v node >/dev/null 2>&1 || return 1
  node -e "
    try {
      const j = require(process.argv[1]);
      const v = String(j.bucket || j.functionPackageBucket || '').trim();
      if (v) process.stdout.write(v);
    } catch (e) {}
  " "$p" 2>/dev/null || true
}

zip_size_bytes() {
  local f="$1"
  if stat -f%z "$f" >/dev/null 2>&1; then
    stat -f%z "$f"
  else
    stat -c%s "$f"
  fi
}

sha256_file() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    echo "" >&2
    echo "Ошибка: нужен shasum (macOS) или sha256sum для SHA256 пакета из бакета." >&2
    exit 1
  fi
}

yc_global=()
FOLDER_FOR_YC="${YC_FOLDER_ID:-${YC_CLI_FOLDER_ID:-}}"
FOLDER_FOR_YC="${FOLDER_FOR_YC#"${FOLDER_FOR_YC%%[![:space:]]*}"}"
FOLDER_FOR_YC="${FOLDER_FOR_YC%"${FOLDER_FOR_YC##*[![:space:]]}"}"

if [[ -z "$FOLDER_FOR_YC" && -n "${YANDEX_CLOUD_FOLDER_ID:-}" ]]; then
  FOLDER_FOR_YC="$YANDEX_CLOUD_FOLDER_ID"
fi
if [[ -z "$FOLDER_FOR_YC" ]]; then
  _from_cfg="$(folder_id_from_deploy_config "$ROOT/deploy.config.json")"
  if [[ -n "$_from_cfg" ]]; then
    FOLDER_FOR_YC="$_from_cfg"
    echo ">>> folder-id из deploy.config.json: $FOLDER_FOR_YC" >&2
  fi
fi
if [[ -z "$FOLDER_FOR_YC" && -f "$ROOT/.youware.json" ]]; then
  _from_cfg="$(folder_id_from_deploy_config "$ROOT/.youware.json")"
  if [[ -n "$_from_cfg" ]]; then
    FOLDER_FOR_YC="$_from_cfg"
    echo ">>> folder-id из .youware.json: $FOLDER_FOR_YC" >&2
  fi
fi
# Каталог из профиля yc (обрезаем перевод строки — иначе пустая проверка может «не сработать»)
if [[ -z "$FOLDER_FOR_YC" ]]; then
  _cfg_folder="$(yc config get folder-id 2>/dev/null || true)"
  _cfg_folder="$(echo -n "$_cfg_folder" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [[ -n "$_cfg_folder" && "$_cfg_folder" != "null" ]]; then
    FOLDER_FOR_YC="$_cfg_folder"
    echo ">>> folder-id из yc config: $FOLDER_FOR_YC" >&2
  fi
fi

func_arg=()
if [[ -n "$FUNC_ID" ]]; then
  func_arg+=(--function-id "$FUNC_ID")
  echo ">>> function-id: $FUNC_ID"
else
  func_arg+=(--function-name "$NAME")
  echo ">>> function-name: $NAME"
  if [[ -z "$FOLDER_FOR_YC" ]]; then
    echo "Ошибка: для функции по имени нужен folder-id. Задайте каталог одним из способов:" >&2
    echo "  1) В survey-app/deploy.config.json добавьте: \"yandexFolderId\": \"b1g…\"" >&2
    echo "  2) yc config set folder-id b1g…" >&2
    echo "  3) export YC_FOLDER_ID=b1g…" >&2
    echo "  (id в URL консоли: …/folders/b1g…/…)" >&2
    exit 1
  fi
fi

if [[ -n "$FOLDER_FOR_YC" ]]; then
  yc_global+=(--folder-id "$FOLDER_FOR_YC")
  echo ">>> folder-id: $FOLDER_FOR_YC"
fi

# Лимит прямой загрузки ZIP в Cloud Functions — 3.5 МБ; больше — только через Object Storage.
MAX_DIRECT_ZIP=$((35 * 1024 * 1024 / 10))
ZIP_SIZE="$(zip_size_bytes "$ZIP")"
SOURCE_ARGS=(--source-path "$ZIP")
if [[ "$ZIP_SIZE" -gt "$MAX_DIRECT_ZIP" || "${YC_FORCE_FUNCTION_PACKAGE_BUCKET:-}" == "1" ]]; then
  PKG_BUCKET="${YC_FUNCTION_PACKAGE_BUCKET:-${YC_BUCKET:-}}"
  if [[ -z "$PKG_BUCKET" ]]; then
    PKG_BUCKET="$(bucket_from_deploy_config "$ROOT/deploy.config.json")"
  fi
  if [[ -z "$PKG_BUCKET" && -f "$ROOT/.youware.json" ]]; then
    PKG_BUCKET="$(bucket_from_deploy_config "$ROOT/.youware.json")"
  fi
  if [[ -z "$PKG_BUCKET" ]]; then
    echo "Архив ${ZIP_SIZE} байт — больше лимита ~3.5 МБ для --source-path." >&2
    echo "Задайте бакет: YC_BUCKET или YC_FUNCTION_PACKAGE_BUCKET (или поле bucket в deploy.config.json)." >&2
    exit 1
  fi
  OBJECT_KEY="${YC_FUNCTION_PACKAGE_OBJECT_KEY:-function-packages/survey-api-bundle.zip}"
  ENDPOINT="${S3_ENDPOINT:-https://storage.yandexcloud.net}"
  REGION="${AWS_DEFAULT_REGION:-ru-central1}"

  echo ">>> ZIP ${ZIP_SIZE} байт — загрузка в s3://$PKG_BUCKET/$OBJECT_KEY" >&2
  _uploaded=0
  if [[ "${YC_FUNCTION_ZIP_UPLOAD:-auto}" != "aws" ]] && yc storage s3 cp --help >/dev/null 2>&1; then
    if yc storage s3 cp "$ZIP" "s3://$PKG_BUCKET/$OBJECT_KEY"; then
      _uploaded=1
    else
      echo ">>> yc storage s3 cp не удался — пробуем aws s3 cp (если есть ключи)…" >&2
    fi
  fi
  if [[ "$_uploaded" != "1" ]]; then
    if ! command -v aws >/dev/null 2>&1; then
      echo "Ошибка: установите aws-cli (brew install awscli) или исправьте yc storage s3 cp." >&2
      echo "Для aws: проверьте AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (без пробелов; ключи из сервисного аккаунта в этом же облаке)." >&2
      echo "SignatureDoesNotMatch — часто неверный Secret или старые ключи; создайте новую пару в консоли IAM." >&2
      exit 1
    fi
    export AWS_EC2_METADATA_DISABLED="${AWS_EC2_METADATA_DISABLED:-true}"
    export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
    export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"
    aws s3 cp "$ZIP" "s3://$PKG_BUCKET/$OBJECT_KEY" --endpoint-url "$ENDPOINT" --region "$REGION"
  fi
  PKG_SHA="$(sha256_file "$ZIP")"
  SOURCE_ARGS=(--package-bucket-name "$PKG_BUCKET" --package-object-name "$OBJECT_KEY" --package-sha256 "$PKG_SHA")
  PKG_SHA12="$(printf '%s' "$PKG_SHA" | awk '{print substr($0,1,12)}')"
  echo ">>> Создание версии из пакета в бакете, sha256 ${PKG_SHA12}..." >&2
fi

echo ">>> yc serverless function version create …"
# С set -u пустой yc_global[@] в некоторых bash даёт «unbound variable» — собираем команду по частям.
yc_cmd=(yc)
if [[ ${#yc_global[@]} -gt 0 ]]; then
  yc_cmd+=("${yc_global[@]}")
fi
yc_cmd+=(
  serverless
  function
  version
  create
  "${func_arg[@]}"
  --runtime "$RUNTIME"
  --entrypoint index.handler
  --memory "$MEMORY"
  --execution-timeout "$TIMEOUT"
  "${SOURCE_ARGS[@]}"
  "${env_args[@]}"
)
"${yc_cmd[@]}"

echo ">>> Готово."
