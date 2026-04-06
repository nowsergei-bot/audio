#!/usr/bin/env bash
# Обходит все каталоги в облаке и вызывает «yc serverless function list» для каждого.
# Нужно, когда в браузере есть survey-api, а в текущем folder список пустой.
#
#   ./scripts/yc-list-functions-all-folders.sh
#
# Другое облако (cloud-id из URL консоли):
#   YC_CLOUD_ID=b1g… ./scripts/yc-list-functions-all-folders.sh
#
export YC_CLI_INITIALIZATION_SILENCE="${YC_CLI_INITIALIZATION_SILENCE:-true}"

set -u

if ! command -v yc >/dev/null 2>&1; then
  echo "yc не найден в PATH" >&2
  exit 1
fi

CLOUD="${YC_CLOUD_ID:-$(yc config get cloud-id 2>/dev/null || true)}"
if [[ -z "$CLOUD" || "$CLOUD" == "null" ]]; then
  echo "Не задан cloud-id. Выполните: yc init" >&2
  exit 1
fi

echo ">>> cloud-id: $CLOUD"
echo ">>> folder-id в профиле yc: $(yc config get folder-id 2>/dev/null || echo '(не задан)')"
echo ""

JSON=$(yc resource-manager folder list --cloud-id "$CLOUD" --format json 2>/dev/null) || {
  echo "Ошибка: yc resource-manager folder list" >&2
  exit 1
}

printf '%s' "$JSON" | python3 -c "
import json, subprocess, sys

raw = json.load(sys.stdin)
folders = []
if isinstance(raw, list):
    folders = raw
elif isinstance(raw, dict):
    for k in ('folders', 'folder', 'items'):
        if k in raw:
            v = raw[k]
            folders = v if isinstance(v, list) else [v]
            break

if not folders:
    print('Не удалось разобрать список каталогов. Выполните:', file=sys.stderr)
    print('  yc resource-manager folder list --cloud-id \"…\" --format json', file=sys.stderr)
    sys.exit(1)

for f in folders:
    fid = f.get('id') or ''
    name = f.get('name') or ''
    if not fid:
        continue
    print(f'========== folder: {name!r}  id={fid} ==========')
    subprocess.run(['yc', '--folder-id', fid, 'serverless', 'function', 'list'], check=False)
    print()

print('Готово. Если survey-api нигде нет — в консоли открыто другое облако: сравните cloud-id в URL с тем, что выше.')
"
