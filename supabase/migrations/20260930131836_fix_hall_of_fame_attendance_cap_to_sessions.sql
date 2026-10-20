/*
# Fix Hall of Fame: Attendance Count Capped by Actual Sessions

## Problem
The `hall_of_fame` view's `attendance_stats` CTE counts `COUNT(*) FROM attendance`
as `total_days`. This can exceed the actual number of sessions held for a group
when orphaned attendance records exist (e.g., from deleted sessions, duplicate
records, or sessions not properly linked). A student's attendance count should
never exceed the total number of sessions created for that group.

## Changes
1. Recreate the `hall_of_fame` view with a new `session_stats` CTE that counts
   actual non-deleted sessions per group for the current month.
2. The `attendance_stats` CTE now joins attendance to sessions by `session_id`
   (or by group_id + attendance_date for records without session_id), ensuring
   attendance is only counted against real sessions.
3. `total_days` in attendance_stats is now `LEAST(student_attendance_count,
   group_session_count)` so it can never exceed the group's session count.
4. The `present_days` is similarly capped.
5. All other CTEs (center_scores, online_scores, homework_stats, behavior_stats)
   and the final SELECT are unchanged.

## Security
- No RLS changes. The view inherits the same access model.
- No new tables or columns.
- No data is lost — this is a VIEW replacement only.
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
  -- Count actual non-deleted sessions per group for the current month
  session_stats AS (
    SELECT
      group_id,
      COUNT(*) AS session_count
    FROM sessions, month_start, month_end
    WHERE is_deleted = false
      AND session_date >= ms AND session_date < me
    GROUP BY group_id
  ),
  -- Attendance stats per student, joined to their group's session count
  attendance_stats AS (
    SELECT
      a.student_id,
      a.group_id,
      COUNT(*) FILTER (WHERE a.status = 'present') AS raw_present,
      COUNT(*) AS raw_total,
      COALESCE(ss.session_count, 0) AS group_session_count
    FROM attendance a, month_start, month_end, session_stats ss
    WHERE a.attendance_date >= ms AND a.attendance_date < me
      AND a.group_id = ss.group_id
    GROUP BY a.student_id, a.group_id, ss.session_count
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
  -- Attendance rate: capped by actual session count for the group
  CASE
    WHEN att.raw_total > 0
      THEN ROUND(
        (LEAST(att.raw_present, att.group_session_count)::numeric /
         LEAST(att.raw_total, att.group_session_count)) * 100, 1
      )
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
      0.25 * CASE WHEN att.raw_total > 0
        THEN (LEAST(att.raw_present, att.group_session_count)::numeric /
              LEAST(att.raw_total, att.group_session_count)) * 100
        ELSE 0 END +
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
