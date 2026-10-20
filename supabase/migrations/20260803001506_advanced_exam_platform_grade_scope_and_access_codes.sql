/*
# Advanced Exam Platform: Grade-Level Scope + Access Codes

1. `exams.group_id` becomes nullable (exams are now scoped to grade_level, not group)
2. New column `exams.grade_level_id` — links exam to a grade level (all groups in that grade can access it)
3. New column `exams.access_code` — auto-generated unique short code for student entry
*/

-- Make group_id nullable (exams can be grade-level scoped now)
ALTER TABLE exams ALTER COLUMN group_id DROP NOT NULL;

-- Add grade_level_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exams' AND column_name = 'grade_level_id'
  ) THEN
    ALTER TABLE exams ADD COLUMN grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add access_code column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exams' AND column_name = 'access_code'
  ) THEN
    ALTER TABLE exams ADD COLUMN access_code text UNIQUE;
  END IF;
END $$;

-- Index for access_code lookups
CREATE INDEX IF NOT EXISTS idx_exams_access_code ON exams(access_code);
CREATE INDEX IF NOT EXISTS idx_exams_grade_level ON exams(grade_level_id);

-- Backfill: set grade_level_id from existing group_id for existing exams
UPDATE exams e
SET grade_level_id = g.grade_level_id
FROM groups g
WHERE e.group_id = g.id AND e.grade_level_id IS NULL;

-- Generate access codes for existing published exams that don't have one
UPDATE exams
SET access_code = UPPER(SUBSTRING(MD5(RANDOM()::text || id::text), 1, 6))
WHERE access_code IS NULL;
