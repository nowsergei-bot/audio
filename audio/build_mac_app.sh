#!/usr/bin/env bash
# Сборка macOS-приложения без зависимости от Python на целевом Mac.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  echo "Создаю виртуальное окружение .venv …"
  python3 -m venv .venv || {
    echo "Не удалось выполнить: python3 -m venv .venv"
    exit 1
  }
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "Устанавливаю зависимости (это может занять несколько минут) …"
pip install -r requirements.txt
pip install -r requirements-build.txt

rm -rf build dist
pyinstaller pyinstaller.spec --noconfirm

echo ""
echo "Готово: $(pwd)/dist/AudioSegmentationQLab.app"
echo "DMG для раздачи: ./build_dmg.sh  →  dist/AudioSegmentationQLab-1.0.0.dmg"
echo "Перенос на другой Mac: положите .app в папку вместе с каталогами audio_files, segmented_output, qlab_playlist"
echo "(они создадутся при первом запуске рядом с .app, если приложение не из /Applications)."
echo "Первый запуск нарезки скачает модель Whisper в ~/.cache/whisper (нужен интернет)."
echo "Для m4a/mp3 установите ffmpeg: brew install ffmpeg"
