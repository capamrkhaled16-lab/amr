
CREATE OR REPLACE FUNCTION upsert_attendance(
  p_student_id uuid,
  p_session_id uuid,
  p_group_id uuid,
  p_attendance_date date,
  p_status text,
  p_late_minutes integer DEFAULT NULL
)
RETURNS SETOF attendance
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO attendance (student_id, session_id, group_id, attendance_date, status, late_minutes)
  VALUES (p_student_id, p_session_id, p_group_id, p_attendance_date, p_status, p_late_minutes)
  ON CONFLICT (student_id, attendance_date, COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    status = EXCLUDED.status,
    late_minutes = EXCLUDED.late_minutes,
    recorded_at = now()
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_attendance TO anon, authenticated;
