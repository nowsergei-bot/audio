#!/usr/bin/env bash
# Сборка ZIP для Cloud Function (Яндекс). В корне архива должны быть index.js и node_modules/.
# Ошибка «битый zip» / 502 часто из‑за: архив с папкой functions/ внутри, без node_modules, артефакты macOS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUNC_DIR="$ROOT/backend/functions"
ZIP="$ROOT/backend/function-bundle.zip"

cd "$FUNC_DIR"
npm install --omit=dev
rm -f "$ZIP"
zip -r "$ZIP" . \
  -x "*.zip" \
  -x "local-server.js" \
  -x "*.DS_Store" \
  -x "**/.DS_Store" \
  -x "__MACOSX/*" \
  -x "**/__MACOSX/*"

# В корне архива должен быть элемент "index.js", не "functions/index.js"
if ! python3 -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1]).namelist()
if 'index.js' not in z:
    print('В архиве нет index.js в корне (нужен путь index.js, не …/index.js).', file=sys.stderr)
    sys.exit(1)
if not any(n.startswith('node_modules/') for n in z):
    print('В архиве нет node_modules/. Запустите npm install в backend/functions.', file=sys.stderr)
    sys.exit(1)
" "$ZIP"; then
  echo "Сборка ZIP отклонена проверкой структуры. Используйте: ./scripts/deploy-functions.sh" >&2
  exit 1
fi

echo "Created $ZIP"
echo "Первые строки содержимого (проверка структуры):"
unzip -l "$ZIP" | head -25 || true
echo "Пример:"
echo "  yc serverless function version create \\"
echo "    --function-name survey-api \\"
echo "    --runtime nodejs18 \\"
echo "    --entrypoint index.handler \\"
echo "    --memory 256m \\"
echo "    --execution-timeout 30s \\"
echo "    --source-path \"$ZIP\" \\"
echo "    --environment PG_CONNECTION_STRING=\"\$PG_CONNECTION_STRING\",ADMIN_API_KEY=\"\$ADMIN_API_KEY\",CORS_ORIGIN=\"https://your-bucket.website.yandexcloud.net\""
