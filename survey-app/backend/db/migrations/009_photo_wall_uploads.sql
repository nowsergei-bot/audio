-- Автономная фотостена (не привязана к опросам): одно фото на участника, модерация
CREATE TABLE IF NOT EXISTS photo_wall_uploads (
  id SERIAL PRIMARY KEY,
  respondent_id TEXT NOT NULL UNIQUE,
  image_data TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_wall_status ON photo_wall_uploads (moderation_status);
