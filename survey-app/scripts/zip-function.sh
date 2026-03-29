#!/usr/bin/env bash
# Простая сборка ZIP для Cloud Function (без проверок). Результат: backend/function-bundle.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUNC="$ROOT/backend/functions"
OUT="$ROOT/backend/function-bundle.zip"

cd "$FUNC"
npm install --omit=dev
rm -f "$OUT"
zip -r "$OUT" . \
  -x "*.zip" \
  -x "local-server.js" \
  -x "*.DS_Store" \
  -x "**/.DS_Store" \
  -x "__MACOSX/*" \
  -x "**/__MACOSX/*"

echo "Готово: $OUT"
ls -lh "$OUT"
