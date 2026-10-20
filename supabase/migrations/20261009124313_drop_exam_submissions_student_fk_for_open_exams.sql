/*
# Drop foreign key on exam_submissions.student_id

## Purpose
Open exams (no group_id, no grade_level_id) allow any student to enter
without being in the students roster. The foreign key constraint on
exam_submissions.student_id → students.id blocks submission creation
for these open exams, causing the exam page to show a load error.

## Changes
1. Drops the `exam_submissions_student_id_fkey` constraint.
2. The student_id column remains uuid NOT NULL — existing roster-based
   exams still pass real student UUIDs. Open exams generate a deterministic
   UUID from the exam ID + student name, which is valid but doesn't need
   to exist in the students table.

## Safety
- No data is deleted or modified.
- No existing submissions, answers, or exam data are affected.
- Roster-based exams continue to work exactly as before.
- The column type and NOT NULL constraint are preserved.
*/

ALTER TABLE exam_submissions
  DROP CONSTRAINT IF EXISTS exam_submissions_student_id_fkey;
