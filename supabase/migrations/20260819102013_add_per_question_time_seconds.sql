/*
# Add per-question time_seconds column to exam_questions

1. Modified Tables
- `exam_questions`:
  - `time_seconds` (integer, nullable): Optional per-question time limit in seconds.
    When null, the exam's `seconds_per_question` is used as fallback.
2. Security
- No RLS changes — existing policies on exam_questions remain unchanged.
3. Notes
- Additive, nullable column — existing questions and code continue to work without modification.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_questions' AND column_name = 'time_seconds') THEN
    ALTER TABLE exam_questions ADD COLUMN time_seconds integer;
  END IF;
END $$;
