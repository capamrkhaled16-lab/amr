/*
# Add unique constraint on exam_answers(submission_id, question_id)

## Purpose
Prevents duplicate answer rows for the same question within the same submission.
This fixes the root cause of duplicate answers being created when auto-save fires
multiple times concurrently.

## Changes
1. Adds unique index on (submission_id, question_id) on exam_answers table.
2. No data loss — existing duplicate rows (if any) are deduplicated first by keeping the latest.
*/

-- Remove existing duplicates before adding constraint
DELETE FROM exam_answers a
WHERE a.id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY submission_id, question_id
      ORDER BY graded_at DESC NULLS LAST
    ) AS rn
    FROM exam_answers
  ) ranked
  WHERE ranked.rn = 1
);

-- Add unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS exam_answers_submission_question_unique
  ON exam_answers (submission_id, question_id);
