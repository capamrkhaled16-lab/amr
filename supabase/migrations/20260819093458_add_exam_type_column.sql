/*
# Add exam_type column to exams table

1. Modified Tables
- `exams` (online exams):
  - `exam_type` (text, NOT NULL, DEFAULT 'online'): Controls whether the exam is for online students or center students.
    - 'online': Exam is for online students only — group selection is hidden, interface is simplified.
    - 'center': Exam is for center students — group selection and related settings are shown as before.
2. Security
- No RLS changes — existing policies on exams remain unchanged.
3. Notes
- The column is additive with a safe default ('online'), so existing exams and code continue to work without modification.
- Existing exams will default to 'online' type. Teachers can change this per exam when creating or editing.
- The exam_type is stored as text (not an enum) to keep the migration simple and avoid enum-related locking issues.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'exam_type') THEN
    ALTER TABLE exams ADD COLUMN exam_type text NOT NULL DEFAULT 'online';
  END IF;
END $$;
