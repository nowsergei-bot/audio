-- Сохранение проекта отчёта по X-Api-Key без сессии (как excel_analytics_projects)
ALTER TABLE phenomenal_report_projects
  ALTER COLUMN user_id DROP NOT NULL;
