/*
# Soft-delete for students & sessions, plus Hall of Fame view

## Overview
1. Adds `is_deleted` (boolean, default false) columns to `students` and `sessions`
   so the app can soft-delete instead of hard-delete, preventing accidental data loss.
2. Adds a `hall_of_fame` SQL view that ranks students by their average exam score
   (combined center + online grades) and attendance rate, surfacing top performers.

## New columns
- `students.is_deleted` boolean NOT NULL DEFAULT false
- `sessions.is_deleted` boolean NOT NULL DEFAULT false

## New view
- `hall_of_fame`: one row per student with name, group name, grade name, stage name,
  avg_score (0-100 normalized), attendance_rate (0-100), and exams_taken count.
  Only includes students with at least one graded exam. Ordered so the app can
  take the top N.

## Safety
- All changes are additive. No data is lost. Existing rows default to is_deleted=false.
- The app filters `is_deleted = false` when reading students/sessions.
*/

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- Hall of Fame view: combines center grades and online grades into a single
-- 0-100 normalized average, plus attendance rate, per student.
CREATE OR REPLACE VIEW hall_of_fame AS
WITH center_scores AS (
  SELECT
    s.id AS student_id,
    s.name AS student_name,
    g.name AS group_name,
    gl.name AS grade_name,
    st.name AS stage_name,
    AVG(LEAST(100, (cg.score / NULLIF(ce.max_score, 0)) * 100)) AS center_avg
  FROM students s
  JOIN groups g ON g.id = s.group_id
  JOIN grade_levels gl ON gl.id = g.grade_level_id
  JOIN academic_stages st ON st.id = gl.stage_id
  JOIN center_grades cg ON cg.student_id = s.id
  JOIN center_exams ce ON ce.id = cg.center_exam_id
  WHERE s.is_deleted = false
  GROUP BY s.id, s.name, g.name, gl.name, st.name
),
online_scores AS (
  SELECT
    s.id AS student_id,
    AVG(LEAST(100, (og.score / NULLIF(og.max_score, 0)) * 100)) AS online_avg,
    COUNT(og.id) AS online_count
  FROM students s
  JOIN online_grades og ON og.student_id = s.id
  WHERE s.is_deleted = false
  GROUP BY s.id
),
center_counts AS (
  SELECT student_id, COUNT(*) AS center_count
  FROM center_grades
  GROUP BY student_id
),
attendance_stats AS (
  SELECT
    student_id,
    COUNT(*) FILTER (WHERE status = 'present') AS present_days,
    COUNT(*) AS total_days
  FROM attendance
  GROUP BY student_id
)
SELECT
  cs.student_id AS id,
  cs.student_name AS name,
  cs.group_name,
  cs.grade_name,
  cs.stage_name,
  COALESCE(cs.center_avg, 0) AS center_avg,
  COALESCE(os.online_avg, 0) AS online_avg,
  -- Combined average: weight center and online equally when both exist
  CASE
    WHEN os.online_avg IS NOT NULL AND cs.center_avg IS NOT NULL
      THEN (cs.center_avg + os.online_avg) / 2
    WHEN os.online_avg IS NOT NULL THEN os.online_avg
    ELSE cs.center_avg
  END AS avg_score,
  COALESCE(cc.center_count, 0) + COALESCE(os.online_count, 0) AS exams_taken,
  CASE
    WHEN att.total_days > 0
      THEN ROUND((att.present_days::numeric / att.total_days) * 100, 1)
    ELSE 0
  END AS attendance_rate
FROM center_scores cs
LEFT JOIN online_scores os ON os.student_id = cs.student_id
LEFT JOIN center_counts cc ON cc.student_id = cs.student_id
LEFT JOIN attendance_stats att ON att.student_id = cs.student_id
ORDER BY avg_score DESC, attendance_rate DESC;
