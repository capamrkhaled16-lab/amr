/*
# Add exam security and result-visibility fields to exams table

1. Modified Tables
- `exams` (online exams):
  - `show_results` (boolean, default true): Controls whether students see their score after submitting. When false, the result screen shows a generic confirmation message instead of the score.
  - `shuffle_questions` (boolean, default false): When true, questions are shuffled per student.
  - `shuffle_choices` (boolean, default false): When true, MCQ choices are shuffled per student.
2. Security
- No RLS changes — existing policies on exams remain unchanged.
3. Notes
- All three columns are additive with safe defaults, so existing exams and code continue to work without modification.
- The existing `is_random` column is preserved; `shuffle_questions` and `shuffle_choices` provide finer-grained control.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'show_results') THEN
    ALTER TABLE exams ADD COLUMN show_results boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'shuffle_questions') THEN
    ALTER TABLE exams ADD COLUMN shuffle_questions boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'shuffle_choices') THEN
    ALTER TABLE exams ADD COLUMN shuffle_choices boolean NOT NULL DEFAULT false;
  END IF;
END $$;
