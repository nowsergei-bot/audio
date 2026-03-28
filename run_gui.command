#!/bin/bash
# Запуск GUI на macOS: двойной щелчок в Finder или запуск из Терминала.
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "Сначала создайте окружение: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  osascript -e 'display dialog "Нет .venv. См. RUN_ON_MAC.txt" buttons {"OK"} default button 1'
  exit 1
fi
exec .venv/bin/python main_gui.py
