#!/bin/bash
# Первый запуск на новом Mac: окружение + зависимости за один проход.
set -e
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Установите Python 3 с https://www.python.org/downloads/macos/"
  exit 1
fi
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install -U pip
./.venv/bin/pip install -r requirements.txt
echo ""
echo "Готово. Запуск GUI:"
echo "  ./run_gui.command"
echo "или:"
echo "  .venv/bin/python main_gui.py"
