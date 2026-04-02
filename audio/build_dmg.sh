#!/usr/bin/env bash
# Упаковка уже собранного .app в сжатый DMG (без доп. программ — только hdiutil).
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR="AudioSegmentationQLab.app"
VOLNAME="AudioSegmentationQLab"
VERSION="${AUDIOSEG_VERSION:-1.0.0}"
DMG_OUT="dist/${VOLNAME}-${VERSION}.dmg"
STAGING="dmg_staging"

if [[ ! -d "dist/${APP_DIR}" ]]; then
  echo "Нет dist/${APP_DIR}. Сначала выполните: ./build_mac_app.sh"
  exit 1
fi

rm -rf "${STAGING}"
mkdir -p "${STAGING}"
ditto "dist/${APP_DIR}" "${STAGING}/${APP_DIR}"
ln -sf /Applications "${STAGING}/Applications"

cat > "${STAGING}/Прочитайте.txt" << 'EOF'
Перетащите AudioSegmentationQLab в папку «Программы» или оставьте приложение в отдельной папке на Рабочем столе (рядом с ним будут данные).

При первом запуске macOS может запросить подтверждение: ПКМ по значку → «Открыть».

Для нарезки m4a/mp3 нужен ffmpeg: дважды нажмите «Установить ffmpeg.command» (нужен установленный Homebrew — https://brew.sh).
Первый запуск нарезки скачает модель Whisper (нужен интернет).
EOF

# Двойной щелчок в Finder: Терминал выполнит brew install ffmpeg (если ещё не стоит).
cat > "${STAGING}/Установить ffmpeg.command" << 'EOF'
#!/bin/bash
# Запускается из образа DMG: устанавливает ffmpeg через Homebrew.
set -euo pipefail
cd "$(dirname "$0")"

if command -v ffmpeg >/dev/null 2>&1; then
  osascript -e 'display dialog "ffmpeg уже установлен в системе." buttons {"OK"} default button 1 with title "AudioSegmentationQLab"'
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  CHOICE=$(osascript -e 'button returned of (display dialog "Нужен Homebrew. Установите его с brew.sh, затем снова дважды нажмите этот файл." buttons {"Отмена", "Открыть сайт"} default button 2 with title "ffmpeg")' 2>/dev/null || echo "Отмена")
  if [[ "$CHOICE" == "Открыть сайт" ]]; then
    open "https://brew.sh"
  fi
  exit 1
fi

echo "Устанавливаю ffmpeg через Homebrew (нужен интернет)…"
if brew install ffmpeg; then
  osascript -e 'display dialog "Готово: ffmpeg установлен. Можно закрыть это окно и пользоваться приложением." buttons {"OK"} default button 1 with title "ffmpeg"'
else
  osascript -e 'display dialog "Ошибка установки. Прочитайте сообщения в окне Терминала выше." buttons {"OK"} default button 1 with title "ffmpeg"'
  echo ""
  read -r -p "Нажмите Enter, чтобы закрыть окно…"
  exit 1
fi
echo ""
read -r -p "Нажмите Enter, чтобы закрыть окно…"
EOF
chmod +x "${STAGING}/Установить ffmpeg.command"

mkdir -p dist
rm -f "${DMG_OUT}"
hdiutil create \
  -volname "${VOLNAME}" \
  -srcfolder "${STAGING}" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "${DMG_OUT}"
rm -rf "${STAGING}"

echo ""
echo "Готово: $(pwd)/${DMG_OUT}"
echo "Этот файл можно переносить на другой Mac (двойной щелчок откроет образ, перетащите .app в Программы)."
