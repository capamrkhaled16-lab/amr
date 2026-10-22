/*
# Add fee_locked column to students

## Purpose
When an admin manually sets a custom fee for a student (e.g. half-month fee
for a late joiner), this column is set to TRUE. The bulk fee sync function
(`syncStudentFeesToGradePrice`) will skip locked students so their manual
amount is never overwritten by automatic grade-level price rollouts.

## Changes
1. New column: `students.fee_locked` (boolean, default false)
2. No RLS changes — existing policies already cover the students table.

## Notes
- This is a non-destructive additive migration.
- Existing students default to `fee_locked = false`, preserving current behavior.
*/

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS fee_locked boolean NOT NULL DEFAULT false;
