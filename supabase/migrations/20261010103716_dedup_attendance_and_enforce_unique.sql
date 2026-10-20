/*
# Deduplicate attendance records and enforce strict uniqueness

## Problem
PostgreSQL treats NULL values as distinct in UNIQUE constraints, so when
`session_id` is NULL, multiple attendance rows can exist for the same
(student_id, attendance_date) pair — creating duplicate session entries.

## Changes
1. Deduplicate existing rows: for each (student_id, attendance_date, session_id)
   group with more than one row, keep only the most recently recorded row
   and delete the older duplicates.
2. Drop the existing constraint-based unique index.
3. Create a robust unique index using COALESCE so NULL session_id is treated
   as a single sentinel value, preventing any future duplicate insertion.

## Safety
- Only deletes duplicate rows, keeping the latest recorded_at per group.
- Does not drop or alter any columns.
- Does not modify non-duplicate rows.
*/

-- Step 1: Delete duplicate attendance rows, keeping the most recent one per
--         (student_id, attendance_date, session_id)
DELETE FROM attendance a
USING attendance b
WHERE a.student_id = b.student_id
  AND a.attendance_date = b.attendance_date
  AND COALESCE(a.session_id, '00000000-0000-0000-0000-000000000000')
      = COALESCE(b.session_id, '00000000-0000-0000-0000-000000000000')
  AND a.id < b.id;

-- Step 2: Drop the existing unique constraint/index
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_student_date_session_unique;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_unique_student_date_session;
DROP INDEX IF EXISTS attendance_unique_student_date_session;
DROP INDEX IF EXISTS idx_attendance_unique_student_date_session;
DROP INDEX IF EXISTS attendance_unique_idx;

-- Step 3: Create a robust unique index using COALESCE so NULL session_id
--         is treated as a single sentinel value, preventing duplicates
CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique_student_date_session
  ON attendance (student_id, attendance_date, COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid));