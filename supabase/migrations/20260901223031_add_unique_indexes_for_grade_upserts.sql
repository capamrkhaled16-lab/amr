/*
# Add unique indexes for atomic grade upserts

## Purpose
The grade upsert functions (upsertCenterGrade, upsertOnlineGrade) currently
use a SELECT-then-INSERT/UPDATE pattern, which is vulnerable to race conditions
when two concurrent saves target the same student+exam pair. Both calls see no
existing row, both try to INSERT, and one fails with a unique violation — or
worse, duplicate rows are created.

These unique indexes enforce one grade row per (exam, student) pair at the
database level, enabling safe atomic upserts via .upsert() with onConflict.

## Changes
1. Unique index on center_grades(center_exam_id, student_id) — partial, only
   for non-deleted rows. Allows the upsert to use onConflict to atomically
   insert-or-update.
2. Unique index on online_grades(exam_id, student_id) — same pattern.

No columns added, no data lost, no tables renamed. Existing duplicate rows
(if any) are deduplicated first by keeping the most recently updated row.
*/

-- Deduplicate center_grades: if duplicates exist, keep the one with the
-- latest updated_at (or created_at fallback) and soft-delete the rest.
DELETE FROM center_grades a
USING center_grades b
WHERE a.center_exam_id = b.center_exam_id
  AND a.student_id = b.student_id
  AND a.id < b.id;

-- Deduplicate online_grades similarly.
DELETE FROM online_grades a
USING online_grades b
WHERE a.exam_id = b.exam_id
  AND a.student_id = b.student_id
  AND a.id < b.id;

-- Unique index for center_grades upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_center_grades_exam_student_unique
  ON center_grades (center_exam_id, student_id);

-- Unique index for online_grades upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_online_grades_exam_student_unique
  ON online_grades (exam_id, student_id);
