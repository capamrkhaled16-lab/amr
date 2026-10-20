/*
# Hall of Fame: Strict Current-Month Data Isolation

## Problem
The existing `hall_of_fame` view aggregates ALL historical data (attendance, grades, homework, behavior)
with no date boundary. This causes August data to bleed into September's rankings.

## Changes
1. DROP and recreate the `hall_of_fame` view with month-boundary filters on all CTEs.
2. All attendance, center_grades, online_grades, homework_status, and behavior_eval CTEs now filter
   to the current calendar month using date_trunc('month', now()).
3. Column names and types are unchanged — the view remains a drop-in replacement.

## Security
- No RLS changes. The view inherits the same access model.
- No new tables or columns.
*/

DROP VIEW IF EXISTS hall_of_fame;

CREATE VIEW hall_of_fame AS
WITH
  month_start AS (
    SELECT date_trunc('month', now())::date AS ms
  ),
  month_end AS (
    SELECT (date_trunc('month', now() + interval '1 month'))::date AS me
  ),
  attendance_stats AS (
    SELECT
      student_id,
      COUNT(*) FILTER (WHERE status = 'present') AS present_days,
      COUNT(*) AS total_days
    FROM attendance, month_start, month_end
    WHERE attendance_date >= ms AND attendance_date < me
    GROUP BY student_id
  ),
  center_scores AS (
    SELECT
      cg.student_id,
      AVG(LEAST(100, (cg.score / NULLIF(ce.max_score, 0)) * 100)) AS center_avg,
      COUNT(cg.id) AS center_count
    FROM center_grades cg
    JOIN center_exams ce ON ce.id = cg.center_exam_id,
    month_start, month_end
    WHERE cg.is_deleted = false
      AND ce.exam_date >= ms AND ce.exam_date < me
    GROUP BY cg.student_id
  ),
  online_scores AS (
    SELECT
      og.student_id,
      AVG(LEAST(100, (og.score / NULLIF(og.max_score, 0)) * 100)) AS online_avg,
      COUNT(og.id) AS online_count
    FROM online_grades og,
    month_start, month_end
    WHERE og.updated_at >= ms AND og.updated_at < me
    GROUP BY og.student_id
  ),
  homework_stats AS (
    SELECT
      hs.student_id,
      COUNT(*) FILTER (WHERE hs.status = 'complete') AS completed_hw,
      COUNT(*) AS total_hw
    FROM homework_status hs,
    month_start, month_end
    WHERE hs.recorded_at >= ms AND hs.recorded_at < me
    GROUP BY hs.student_id
  ),
  behavior_stats AS (
    SELECT
      be.student_id,
      COUNT(*) FILTER (WHERE be.rating IN ('excellent', 'participatory')) AS positive_ratings,
      COUNT(*) AS total_ratings
    FROM behavior_eval be,
    month_start, month_end
    WHERE be.eval_date >= ms AND be.eval_date < me
    GROUP BY be.student_id
  )
SELECT
  s.id AS id,
  s.name AS name,
  g.id AS group_id,
  g.name AS group_name,
  gl.name AS grade_name,
  st.name AS stage_name,
  COALESCE(
    CASE
      WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL
        THEN (cs.center_avg + os.online_avg) / 2
      WHEN os.online_avg IS NOT NULL THEN os.online_avg
      WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
      ELSE 0
    END, 0
  ) AS avg_score,
  CASE
    WHEN att.total_days > 0
      THEN ROUND((att.present_days::numeric / att.total_days) * 100, 1)
    ELSE 0
  END AS attendance_rate,
  CASE
    WHEN hw.total_hw > 0
      THEN ROUND((hw.completed_hw::numeric / hw.total_hw) * 100, 1)
    ELSE 0
  END AS homework_rate,
  CASE
    WHEN beh.total_ratings > 0
      THEN ROUND((beh.positive_ratings::numeric / beh.total_ratings) * 100, 1)
    ELSE 0
  END AS behavior_score,
  COALESCE(cs.center_count, 0) + COALESCE(os.online_count, 0) AS exams_taken,
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
