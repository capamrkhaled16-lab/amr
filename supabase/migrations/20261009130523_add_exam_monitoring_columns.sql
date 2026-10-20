/*
# Add live monitoring columns to exam_submissions

## Purpose
Enables real-time teacher monitoring of student progress during online exams.
Tracks which question the student is currently viewing, how many they've answered,
and when they were last active — without modifying answers, timers, or attempt data.

## Changes
1. Adds `current_question_index` (int, default 0, nullable) — zero-based index of the question the student is currently viewing.
2. Adds `answered_count` (int, default 0, nullable) — number of questions the student has answered so far.
3. Adds `last_activity_at` (timestamptz, nullable) — server timestamp of the student's last navigation or answer-save event.

## Safety
- All three columns are nullable with defaults — existing submissions are unaffected.
- No existing data is modified or deleted.
- No constraints, indexes, or policies are changed.
- These columns are purely informational for monitoring; they do not affect grading, timers, or submission status.
*/

ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS current_question_index int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS answered_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
