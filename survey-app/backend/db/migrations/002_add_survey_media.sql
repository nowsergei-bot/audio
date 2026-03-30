-- Добавляет media (JSON) к опросу: фото мероприятия для слайдшоу.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '{}'::jsonb;

