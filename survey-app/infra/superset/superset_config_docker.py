# Конфиг для контейнера apache/superset (монтируется как superset_config.py).
# Документация: https://superset.apache.org/docs/configuration/configuring-superset

import os

SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "please-change-me-use-openssl-rand-hex-42")

_meta = os.environ.get(
    "SUPERSET_DATABASE_URI",
    "postgresql+psycopg2://superset:superset@superset-meta:5432/superset",
)
SQLALCHEMY_DATABASE_URI = _meta

# Кэш (Redis в compose)
CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": os.environ.get("REDIS_HOST", "redis"),
    "CACHE_REDIS_PORT": int(os.environ.get("REDIS_PORT", "6379")),
}

WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = False
