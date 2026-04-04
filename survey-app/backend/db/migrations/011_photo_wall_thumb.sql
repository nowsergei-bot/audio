-- Превью для списка модерации и лёгкого публичного коллажа (полный image_data остаётся в БД)
ALTER TABLE photo_wall_uploads ADD COLUMN IF NOT EXISTS thumb_data TEXT;
