#!/usr/bin/env bash
# Локальная инициализация Superset перед запуском gunicorn (образ apache/superset).
set -euo pipefail

superset db upgrade

superset fab create-admin \
  --username "${SUPERSET_ADMIN_USER:-admin}" \
  --firstname Admin \
  --lastname User \
  --email "${SUPERSET_ADMIN_EMAIL:-admin@example.local}" \
  --password "${SUPERSET_ADMIN_PASSWORD:-admin}" \
  2>/dev/null || true

superset init

exec /usr/bin/run-server.sh
