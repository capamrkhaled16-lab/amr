
/*
# Fix: "column reference 'id' is ambiguous" in upsert_attendance

## Root Cause
The function's RETURNS TABLE(id uuid, ...) creates an output parameter
named "id" that collides with the attendance.id column inside the
function body. In PL/pgSQL, the UPDATE's `WHERE id = v_existing_id`
and INSERT's `RETURNING id` are ambiguous between the table column
and the output parameter, causing:

  ERROR: column reference "id" is ambiguous

## Fix
1. Rename the return column from `id` to `row_id` to eliminate the
   name collision entirely.
2. Qualify all UPDATE WHERE clauses with `attendance.id` for extra safety.
3. The INSERT `RETURNING id` is now unambiguous since the output param
   is `row_id`, not `id`.
*/

DROP FUNCTION IF EXISTS public.upsert_attendance(
  uuid, uuid, text, text, date, uuid, timestamptz, integer
);

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
RETURNS TABLE(row_id uuid, inserted boolean)
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
    WHERE attendance.id = v_existing_id;

    RETURN QUERY SELECT v_existing_id AS row_id, false;
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

      RETURN QUERY SELECT v_inserted_id AS row_id, true;
    EXCEPTION WHEN unique_violation THEN
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
        WHERE attendance.id = v_existing_id;

        RETURN QUERY SELECT v_existing_id AS row_id, false;
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
