CREATE OR REPLACE VIEW hall_of_fame AS
 WITH month_start AS (
         SELECT date_trunc('month'::text, now())::date AS ms
        ), month_end AS (
         SELECT date_trunc('month'::text, now() + '1 mon'::interval)::date AS me
        ), session_stats AS (
         SELECT sessions.group_id,
            count(*) AS session_count
           FROM sessions,
            month_start,
            month_end
          WHERE sessions.is_deleted = false AND sessions.session_date >= month_start.ms AND sessions.session_date < month_end.me
          GROUP BY sessions.group_id
        ), attendance_stats AS (
         SELECT a.student_id,
            a.group_id,
            count(*) FILTER (WHERE a.status = 'present'::text) AS raw_present,
            count(*) AS raw_total,
            COALESCE(ss.session_count, 0::bigint) AS group_session_count
           FROM attendance a,
            month_start,
            month_end,
            session_stats ss
          WHERE a.attendance_date >= month_start.ms AND a.attendance_date < month_end.me AND a.group_id = ss.group_id
          GROUP BY a.student_id, a.group_id, ss.session_count
        ), center_scores AS (
         SELECT cg.student_id,
            avg(LEAST(100::numeric, cg.score / NULLIF(ce.max_score, 0::numeric) * 100::numeric)) AS center_avg,
            count(cg.id) AS center_count
           FROM center_grades cg
             JOIN center_exams ce ON ce.id = cg.center_exam_id,
            month_start,
            month_end
          WHERE cg.is_deleted = false AND ce.exam_date >= month_start.ms AND ce.exam_date < month_end.me
          GROUP BY cg.student_id
        ), online_scores AS (
         SELECT og.student_id,
            avg(LEAST(100::numeric, og.score / NULLIF(og.max_score, 0::numeric) * 100::numeric)) AS online_avg,
            count(og.id) AS online_count
           FROM online_grades og
             JOIN exams e ON e.id = og.exam_id,
            month_start,
            month_end
          WHERE COALESCE(e.open_at, og.updated_at) >= month_start.ms AND COALESCE(e.open_at, og.updated_at) < month_end.me
          GROUP BY og.student_id
        ), homework_stats AS (
         SELECT hs.student_id,
            SUM(CASE WHEN hs.status = 'complete'::text THEN 1.0 WHEN hs.status = 'late'::text THEN 0.5 ELSE 0 END) AS weighted_hw,
            count(*) AS total_hw
           FROM homework_status hs,
            month_start,
            month_end
          WHERE hs.recorded_at >= month_start.ms AND hs.recorded_at < month_end.me
          GROUP BY hs.student_id
        ), behavior_stats AS (
         SELECT be.student_id,
            count(*) FILTER (WHERE be.rating = ANY (ARRAY['excellent'::text, 'participatory'::text])) AS positive_ratings,
            count(*) AS total_ratings
           FROM behavior_eval be,
            month_start,
            month_end
          WHERE be.eval_date >= month_start.ms AND be.eval_date < month_end.me
          GROUP BY be.student_id
        )
 SELECT s.id,
    s.name,
    g.id AS group_id,
    g.name AS group_name,
    gl.name AS grade_name,
    st.name AS stage_name,
    COALESCE(
        CASE
            WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL THEN (cs.center_avg + os.online_avg) / 2::numeric
            WHEN os.online_avg IS NOT NULL THEN os.online_avg
            WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
            ELSE 0::numeric
        END, 0::numeric) AS avg_score,
        CASE
            WHEN att.raw_total > 0 THEN round(LEAST(att.raw_present, att.group_session_count)::numeric / LEAST(att.raw_total, att.group_session_count)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS attendance_rate,
        CASE
            WHEN hw.total_hw > 0 THEN round(hw.weighted_hw / hw.total_hw::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS homework_rate,
        CASE
            WHEN beh.total_ratings > 0 THEN round(beh.positive_ratings::numeric / beh.total_ratings::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS behavior_score,
    COALESCE(cs.center_count, 0::bigint) + COALESCE(os.online_count, 0::bigint) AS exams_taken,
    round(0.35 * COALESCE(
        CASE
            WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL THEN (cs.center_avg + os.online_avg) / 2::numeric
            WHEN os.online_avg IS NOT NULL THEN os.online_avg
            WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
            ELSE 0::numeric
        END, 0::numeric) + 0.25 *
        CASE
            WHEN att.raw_total > 0 THEN LEAST(att.raw_present, att.group_session_count)::numeric / LEAST(att.raw_total, att.group_session_count)::numeric * 100::numeric
            ELSE 0::numeric
        END + 0.20 *
        CASE
            WHEN hw.total_hw > 0 THEN hw.weighted_hw / hw.total_hw::numeric * 100::numeric
            ELSE 0::numeric
        END + 0.20 *
        CASE
            WHEN beh.total_ratings > 0 THEN beh.positive_ratings::numeric / beh.total_ratings::numeric * 100::numeric
            ELSE 0::numeric
        END, 2) AS overall_score
   FROM students s
     JOIN groups g ON g.id = s.group_id
     JOIN grade_levels gl ON gl.id = g.grade_level_id
     JOIN academic_stages st ON st.id = gl.stage_id
     LEFT JOIN attendance_stats att ON att.student_id = s.id AND att.group_id = g.id
     LEFT JOIN center_scores cs ON cs.student_id = s.id
     LEFT JOIN online_scores os ON os.student_id = s.id
     LEFT JOIN homework_stats hw ON hw.student_id = s.id
     LEFT JOIN behavior_stats beh ON beh.student_id = s.id
  WHERE s.is_deleted = false
  ORDER BY (round(0.35 * COALESCE(
        CASE
            WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL THEN (cs.center_avg + os.online_avg) / 2::numeric
            WHEN os.online_avg IS NOT NULL THEN os.online_avg
            WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
            ELSE 0::numeric
        END, 0::numeric) + 0.25 *
        CASE
            WHEN att.raw_total > 0 THEN LEAST(att.raw_present, att.group_session_count)::numeric / LEAST(att.raw_total, att.group_session_count)::numeric * 100::numeric
            ELSE 0::numeric
        END + 0.20 *
        CASE
            WHEN hw.total_hw > 0 THEN hw.weighted_hw / hw.total_hw::numeric * 100::numeric
            ELSE 0::numeric
        END + 0.20 *
        CASE
            WHEN beh.total_ratings > 0 THEN beh.positive_ratings::numeric / beh.total_ratings::numeric * 100::numeric
            ELSE 0::numeric
        END, 2)) DESC, (COALESCE(
        CASE
            WHEN cs.center_avg IS NOT NULL AND os.online_avg IS NOT NULL THEN (cs.center_avg + os.online_avg) / 2::numeric
            WHEN os.online_avg IS NOT NULL THEN os.online_avg
            WHEN cs.center_avg IS NOT NULL THEN cs.center_avg
            ELSE 0::numeric
        END, 0::numeric)) DESC, (
        CASE
            WHEN att.raw_total > 0 THEN round(LEAST(att.raw_present, att.group_session_count)::numeric / LEAST(att.raw_total, att.group_session_count)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END) DESC, s.name;
