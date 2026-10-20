/*
# Add student_name and student_phone to exam_submissions

1. Modified Tables
- `exam_submissions`:
  - `student_name` (text, nullable): Stores the walk-in student's full name directly
    on the submission row, so results are visible in the dashboard even when the
    student is not registered in the `students` table.
  - `student_phone` (text, nullable): Stores the walk-in student's phone/code.

2. Security
- No RLS changes — existing policies on exam_submissions remain unchanged.

3. Notes
- Additive, nullable columns — existing submissions and code continue to work.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_submissions' AND column_name = 'student_name') THEN
    ALTER TABLE exam_submissions ADD COLUMN student_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_submissions' AND column_name = 'student_phone') THEN
    ALTER TABLE exam_submissions ADD COLUMN student_phone text;
  END IF;
END $$;
