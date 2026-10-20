/*
# Add exception handling to upsert_attendance RPC

## Problem
The initial version of upsert_attendance does SELECT-then-INSERT/UPDATE.
Under a race condition (double-tap, concurrent requests), two calls could
both SELECT (find no existing row), then both INSERT — the second INSERT
hits the unique index and throws.

## Fix
Add an EXCEPTION block: if the INSERT fails with unique_violation (23505),
retry as an UPDATE on the conflicting row. This makes the function
race-safe without needing advisory locks.
*/

CREATE OR REPLACE FUNCTION public.upsert_attendance(
  p_student_id uuid,
  p_group_id uuid,
  p_status text,
  p_notes text,
  p_attendance_date date,
  p_session_id uuid,
  p_recorded_at timestamptz,
  p_late_minutes integer DEFAULT NULL
)
RETURNS TABLE(id uuid, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_late_minutes integer;
  v_inserted_id uuid;
BEGIN
  IF p_status = 'late' THEN
    v_late_minutes := p_late_minutes;
  ELSE
    v_late_minutes := NULL;
  END IF;

  SELECT a.id INTO v_existing_id
  FROM attendance a
  WHERE a.student_id = p_student_id
    AND a.attendance_date = p_attendance_date
    AND COALESCE(a.session_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE attendance
    SET
      status = p_status,
      notes = p_notes,
      group_id = p_group_id,
      session_id = p_session_id,
      recorded_at = p_recorded_at,
      late_minutes = v_late_minutes
    WHERE id = v_existing_id;

    RETURN QUERY SELECT v_existing_id, false;
  ELSE
    BEGIN
      INSERT INTO attendance (
        student_id, group_id, status, notes,
        attendance_date, session_id, recorded_at, late_minutes
      )
      VALUES (
        p_student_id, p_group_id, p_status, p_notes,
        p_attendance_date, p_session_id, p_recorded_at, v_late_minutes
      )
      RETURNING id INTO v_inserted_id;

      RETURN QUERY SELECT v_inserted_id, true;
    EXCEPTION WHEN unique_violation THEN
      -- Race condition: another call inserted first. Fall back to UPDATE.
      SELECT a.id INTO v_existing_id
      FROM attendance a
      WHERE a.student_id = p_student_id
        AND a.attendance_date = p_attendance_date
        AND COALESCE(a.session_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE attendance
        SET
          status = p_status,
          notes = p_notes,
          group_id = p_group_id,
          session_id = p_session_id,
          recorded_at = p_recorded_at,
          late_minutes = v_late_minutes
        WHERE id = v_existing_id;

        RETURN QUERY SELECT v_existing_id, false;
      ELSE
        RAISE EXCEPTION 'upsert_attendance: unique_violation but no existing row found';
      END IF;
    END;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_attendance(
  uuid, uuid, text, text, date, uuid, timestamptz, integer
) TO authenticated;
