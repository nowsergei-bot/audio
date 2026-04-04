-- Полная очистка фотостены: все строки удаляются, счётчик id сбрасывается.
-- Объекты в Object Storage (если были) этот скрипт НЕ удаляет — только PostgreSQL.
-- Выполните вручную в Neon SQL Editor или: psql "$PG_CONNECTION_STRING" -f ...

TRUNCATE TABLE photo_wall_uploads RESTART IDENTITY;
