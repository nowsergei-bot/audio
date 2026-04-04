#!/usr/bin/env bash
# Залить готовый ZIP в Cloud Function (без пересборки). См. publish-function-yandex.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/publish-function-yandex.sh" upload "$@"
