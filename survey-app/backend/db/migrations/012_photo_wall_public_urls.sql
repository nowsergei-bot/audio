-- Публичные URL в Object Storage (JSON ответов без base64)
ALTER TABLE photo_wall_uploads ALTER COLUMN image_data DROP NOT NULL;
ALTER TABLE photo_wall_uploads ADD COLUMN IF NOT EXISTS thumb_public_url TEXT;
ALTER TABLE photo_wall_uploads ADD COLUMN IF NOT EXISTS image_public_url TEXT;
