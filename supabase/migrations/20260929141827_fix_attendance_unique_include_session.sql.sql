/*
# Fix attendance unique constraint to include session_id

## Problem
The current unique constraint `attendance_student_id_attendance_date_key` is on `(student_id, attendance_date)` only.
When a student attends two different sessions on the same date, the second upsert OVERWRITES the first attendance record.
The upsert in the frontend uses `onConflict: 'student_id,attendance_date'` which matches this constraint.

## Fix
1. Drop the old unique constraint `attendance_student_id_attendance_date_key`.
2. Drop the redundant unique index `attendance_student_date_unique` (same columns, duplicate of the constraint).
3. Create a new unique constraint on `(student_id, attendance_date, session_id)` so attendance is unique per student per date per session.
4. This allows a student to have separate attendance records for different sessions on the same date.

## Safety
- No data is lost. Existing rows keep their data.
- If any duplicates exist on (student_id, attendance_date, session_id), they would need manual cleanup first,
  but since the old constraint already prevented exact (student_id, attendance_date) duplicates, there cannot be
  duplicates on the narrower (student_id, attendance_date, session_id) set.
*/

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_student_id_attendance_date_key;
DROP INDEX IF EXISTS attendance_student_date_unique;
ALTER TABLE attendance ADD CONSTRAINT attendance_student_date_session_unique UNIQUE (student_id, attendance_date, session_id);
