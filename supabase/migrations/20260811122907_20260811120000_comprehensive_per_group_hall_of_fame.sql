/*
# Comprehensive per-group Hall of Fame

## Purpose
Replace the old global hall_of_fame view with a per-group, comprehensive ranking
that considers ALL evaluation elements in the system:
  - Attendance (present vs total)
  - Homework completion rate
  - Behavior ratings (excellent/participatory = positive)
  - Center exam grades (normalized to 0-100)
  - Online exam grades (normalized to 0-100)

The view is scoped per group (group_id column) so each group has its own
independent ranking. Tie-breaking uses a deterministic composite score
(overall_score) so students with equal scores get consistent ordering.

## Changes
1. DROP the existing `hall_of_fame` view.
2. CREATE a new `hall_of_fame` view with columns:
   - id (student id)
   - name
   - group_id
   - group_name
   - grade_name
   - stage_name
   - avg_score (combined normalized exam average, 0-100)
   - attendance_rate (0-100, one decimal)
   - homework_rate (0-100, percent of homework marked complete)
   - behavior_score (0-100, percent of positive ratings)
   - exams_taken (count of graded exams)
   - overall_score (weighted composite: 35% exams, 25% attendance, 20% homework, 20% behavior)
   Ordered by overall_score DESC, then avg_score DESC, then attendance_rate DESC,
   then name ASC — fully deterministic tie-breaking.

3. Only includes students that are not soft-deleted and belong to a group.
   A student appears even with zero exams (overall_score derived from other
   metrics), so the ranking reflects all group members, not just those who
   took exams.

## Security
- This is a VIEW; no RLS policies needed (views inherit underlying table RLS).
- No data is lost; the old view is replaced but the underlying tables are untouched.
*/

DROP VIEW IF EXISTS hall_of_fame;

CREATE VIEW hall_of_fame AS
WITH
-- Attendance stats per student
attendance_stats AS (
  SELECT
    student_id,
    COUNT(*) FILTER (WHERE status = 'present') AS present_days,
    COUNT(*) AS total_days
  FROM attendance
  GROUP BY student_id
),
-- Center grades normalized
center_scores AS (
  SELECT
    cg.student_id,
    AVG(LEAST(100, (cg.score / NULLIF(ce.max_score, 0)) * 100)) AS center_avg,
    COUNT(cg.id) AS center_count
  FROM center_grades cg
  JOIN center_exams ce ON ce.id = cg.center_exam_id
  GROUP BY cg.student_id
),
-- Online grades normalized
online_scores AS (
  SELECT
    og.student_id,
    AVG(LEAST(100, (og.score / NULLIF(og.max_score, 0)) * 100)) AS online_avg,
    COUNT(og.id) AS online_count
  FROM online_grades og
  GROUP BY og.student_id
),
-- Homework completion rate
homework_stats AS (
  SELECT
    hs.student_id,
    COUNT(*) FILTER (WHERE hs.status = 'complete') AS completed_hw,
    COUNT(*) AS total_hw
  FROM homework_status hs
  GROUP BY hs.student_id
),
-- Behavior: positive = excellent or participatory
behavior_stats AS (
  SELECT
    be.student_id,
    COUNT(*) FILTER (WHERE be.rating IN ('excellent', 'participatory')) AS positive_ratings,
    COUNT(*) AS total_ratings
  FROM behavior_eval be
  GROUP BY be.student_id
)
SELECT
  s.id AS id,
  s.name AS name,
  g.id AS group_id,
  g.name AS group_name,
  gl.name AS grade_name,
  st.name AS stage_name,
  -- Combined exam average (center + online, weighted equally when both exist)
  COALESCE(
    CASE
      WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL
        THEN (cs.center_avg + os.online_avg) / 2
      WHEN os.online_avg IS NOT NULL THEN os.online_avg
      WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
      ELSE 0
    END, 0
  ) AS avg_score,
  -- Attendance rate
  CASE
    WHEN att.total_days > 0
      THEN ROUND((att.present_days::numeric / att.total_days) * 100, 1)
    ELSE 0
  END AS attendance_rate,
  -- Homework completion rate
  CASE
    WHEN hw.total_hw > 0
      THEN ROUND((hw.completed_hw::numeric / hw.total_hw) * 100, 1)
    ELSE 0
  END AS homework_rate,
  -- Behavior positive rate
  CASE
    WHEN beh.total_ratings > 0
      THEN ROUND((beh.positive_ratings::numeric / beh.total_ratings) * 100, 1)
    ELSE 0
  END AS behavior_score,
  -- Total exams taken
  COALESCE(cs.center_count, 0) + COALESCE(os.online_count, 0) AS exams_taken,
  -- Overall composite score (weighted):
  --   35% exam average, 25% attendance, 20% homework, 20% behavior
  ROUND(
    (
      0.35 * COALESCE(
        CASE
          WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL
            THEN (cs.center_avg + os.online_avg) / 2
          WHEN os.online_avg IS NOT NULL THEN os.online_avg
          WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
          ELSE 0
        END, 0
      ) +
      0.25 * CASE WHEN att.total_days > 0 THEN (att.present_days::numeric / att.total_days) * 100 ELSE 0 END +
      0.20 * CASE WHEN hw.total_hw > 0 THEN (hw.completed_hw::numeric / hw.total_hw) * 100 ELSE 0 END +
      0.20 * CASE WHEN beh.total_ratings > 0 THEN (beh.positive_ratings::numeric / beh.total_ratings) * 100 ELSE 0 END
    )::numeric, 2
  ) AS overall_score
FROM students s
JOIN groups g ON g.id = s.group_id
JOIN grade_levels gl ON gl.id = g.grade_level_id
JOIN academic_stages st ON st.id = gl.stage_id
LEFT JOIN attendance_stats att ON att.student_id = s.id
LEFT JOIN center_scores cs ON cs.student_id = s.id
LEFT JOIN online_scores os ON os.student_id = s.id
LEFT JOIN homework_stats hw ON hw.student_id = s.id
LEFT JOIN behavior_stats beh ON beh.student_id = s.id
WHERE s.is_deleted = false
ORDER BY overall_score DESC, avg_score DESC, attendance_rate DESC, name ASC;
