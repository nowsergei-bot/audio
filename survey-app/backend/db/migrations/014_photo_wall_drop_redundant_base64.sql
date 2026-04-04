-- Убрать дубликат тяжёлого base64 в image_data, если уже есть публичный URL (меньше данных в Neon при чтении).
-- Нужна миграция 012 (image_data nullable, image_public_url).
UPDATE photo_wall_uploads
SET image_data = NULL
WHERE NULLIF(trim(COALESCE(image_public_url, '')), '') IS NOT NULL;
