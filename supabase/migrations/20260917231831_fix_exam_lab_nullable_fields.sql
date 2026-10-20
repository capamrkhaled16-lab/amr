-- Make user_id nullable on exam_lab_exams and exam_lab_questions
-- This app uses PIN-based auth, not Supabase built-in auth, so auth.uid() is always NULL
ALTER TABLE exam_lab_exams ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE exam_lab_questions ALTER COLUMN user_id DROP NOT NULL;

-- Make numeric fields nullable so they can be empty (not forced to defaults)
ALTER TABLE exam_lab_exams ALTER COLUMN duration_minutes DROP NOT NULL;
ALTER TABLE exam_lab_exams ALTER COLUMN total_marks DROP NOT NULL;
ALTER TABLE exam_lab_questions ALTER COLUMN marks DROP NOT NULL;
