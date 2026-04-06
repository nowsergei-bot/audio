-- Проекты Excel без пользователя в БД: только X-Api-Key (общий пул для админского ключа).

ALTER TABLE excel_analytics_projects
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN excel_analytics_projects.user_id IS
  'Пользователь; NULL — проекты, созданные только с валидным X-Api-Key (без Bearer-сессии).';
