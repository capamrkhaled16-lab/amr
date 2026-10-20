-- Add category column to center_exams to support separate sections:
-- exams (امتحانات), sheets (شيتات), recitation (تسميع)
ALTER TABLE center_exams ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'exam';

-- Add index for filtering by category
CREATE INDEX IF NOT EXISTS idx_center_exams_category ON center_exams(category);