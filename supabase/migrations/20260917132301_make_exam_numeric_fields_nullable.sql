-- Make exam numeric fields nullable so empty values can be stored as NULL
ALTER TABLE exams ALTER COLUMN duration_minutes DROP NOT NULL;
ALTER TABLE exams ALTER COLUMN duration_minutes DROP DEFAULT;
ALTER TABLE exams ALTER COLUMN seconds_per_question DROP NOT NULL;
ALTER TABLE exams ALTER COLUMN seconds_per_question DROP DEFAULT;
ALTER TABLE exams ALTER COLUMN total_score DROP NOT NULL;
ALTER TABLE exams ALTER COLUMN total_score DROP DEFAULT;
