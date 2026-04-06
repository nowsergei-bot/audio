#!/usr/bin/env bash
# Загрузка собранного фронтенда в бакет Yandex Object Storage (S3-совместимый API).
# Требуется: aws-cli и учётные данные (переменные AWS_* или профиль ~/.aws для Object Storage).
#
# Переменные окружения:
#   YC_BUCKET          — имя бакета (обязательно)
#   AWS_ACCESS_KEY_ID  — опционально, если не задан профиль aws-cli
#   AWS_SECRET_ACCESS_KEY
#   DIST_DIR           — путь к dist (по умолчанию: ../frontend/dist относительно этого скрипта)
#
# Пример:
#   export YC_BUCKET=my-school-surveys
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   ./scripts/sync-object-storage.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${DIST_DIR:-$ROOT/frontend/dist}"
ENDPOINT="https://storage.yandexcloud.net"

if [[ -z "${YC_BUCKET:-}" ]]; then
  echo "Задайте YC_BUCKET=имя-вашего-бакета" >&2
  exit 1
fi
# Ключи: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY в env или профиль ~/.aws (aws configure)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo ">>> Ключи не в env — aws-cli возьмёт профиль по умолчанию (если настроен)." >&2
fi
if [[ ! -d "$DIST" ]]; then
  echo "Нет папки сборки: $DIST — сначала выполните: cd frontend && npm run build" >&2
  exit 1
fi

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ru-central1}"
# AWS CLI ≥2.23: иначе PutObject на Yandex даёт XAmzContentSHA256Mismatch / checksum
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

NFILES="$(find "$DIST" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo ">>> Локальная папка: $DIST"
echo ">>> Файлов для загрузки: $NFILES"
if [[ "$NFILES" -eq 0 ]]; then
  echo "Ошибка: в dist нет файлов. Выполните: cd frontend && npm run build" >&2
  exit 1
fi
find "$DIST" -type f | head -15
[[ "$NFILES" -gt 15 ]] && echo ">>> ... и ещё $((NFILES - 15)) файлов"

# aws s3 sync --delete иначе сотрёт объекты в бакете, которых нет в dist (например ZIP для CF).
# Если в бакете есть объекты под префиксом — подтягиваем их в dist (пустую папку не создаём: иначе ZIP всё равно сотрётся).
# Список через запятую; отключить: YC_S3_SYNC_PRESERVE_PREFIXES=
IFS=',' read -ra _PRESERVE <<< "${YC_S3_SYNC_PRESERVE_PREFIXES-function-packages}"
for _prefix in "${_PRESERVE[@]}"; do
  _p="${_prefix//[[:space:]]/}"
  [[ -z "$_p" ]] && continue
  _p="${_p%/}"
  if aws s3 ls "s3://$YC_BUCKET/$_p/" --endpoint-url "$ENDPOINT" --region "$AWS_DEFAULT_REGION" 2>/dev/null | head -1 | grep -q .; then
    echo ">>> Перед sync: s3://$YC_BUCKET/$_p/ → $DIST/$_p/ (чтобы --delete не стёр префикс)" >&2
    mkdir -p "$DIST/$_p"
    aws s3 sync "s3://$YC_BUCKET/$_p" "$DIST/$_p" --endpoint-url "$ENDPOINT" --region "$AWS_DEFAULT_REGION"
  fi
done

echo ">>> Синхронизация → s3://$YC_BUCKET/ (endpoint $ENDPOINT)"
# Для публичного сайта часто нужен ACL на объекты; в консоли можно вместо этого задать политику бакета.
SYNC_FLAGS=(--delete)
if [[ "${YC_OBJECT_ACL_PUBLIC_READ:-}" == "1" ]]; then
  SYNC_FLAGS+=(--acl public-read)
fi
if ! aws s3 sync "$DIST" "s3://$YC_BUCKET/" \
  --endpoint-url "$ENDPOINT" \
  --region "$AWS_DEFAULT_REGION" \
  "${SYNC_FLAGS[@]}"; then
  echo "Ошибка: aws s3 sync завершился с ошибкой (см. сообщение выше)." >&2
  echo "Подсказка: ключи (export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), роль storage.editor, checksum — скрипт уже выставляет when_required для Yandex." >&2
  exit 1
fi

# index.html без долгого кэша на CDN/браузере — после деплоя подтягивается новая ссылка на JS/CSS
INDEX="$DIST/index.html"
if [[ -f "$INDEX" ]]; then
  echo ">>> Обновляю Cache-Control у index.html (no-cache)"
  CP_FLAGS=(--cache-control "no-cache, no-store, must-revalidate" --content-type "text/html; charset=utf-8")
  if [[ "${YC_OBJECT_ACL_PUBLIC_READ:-}" == "1" ]]; then
    CP_FLAGS+=(--acl public-read)
  fi
  aws s3 cp "$INDEX" "s3://$YC_BUCKET/index.html" \
    --endpoint-url "$ENDPOINT" \
    --region "$AWS_DEFAULT_REGION" \
    "${CP_FLAGS[@]}" \
    || echo "Предупреждение: не удалось выставить Cache-Control для index.html" >&2
fi

echo ">>> Проверка: объекты в бакете (первые 30 строк):"
aws s3 ls "s3://$YC_BUCKET/" --endpoint-url "$ENDPOINT" --region "$AWS_DEFAULT_REGION" --recursive 2>&1 | head -30 || true

echo ">>> Готово. Сайт: https://${YC_BUCKET}.website.yandexcloud.net/"
