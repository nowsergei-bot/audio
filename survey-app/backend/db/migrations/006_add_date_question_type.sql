DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'question_type') THEN
    ALTER TYPE question_type ADD VALUE IF NOT EXISTS 'date';
  END IF;
END $$;

