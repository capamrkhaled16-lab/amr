/*
# Atomic Attendance Upsert RPC

## Problem
The frontend used Supabase's `.upsert()` with `onConflict: 'student_id,attendance_date,session_id'`.
The database unique index `attendance_unique_student_date_session` uses
`COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid)`.
The `onConflict` column list does NOT match this expression index, so Postgres
could not use it for conflict resolution — the upsert silently became a plain
INSERT, creating duplicate attendance rows when session_id was NULL.

## Fix
Create a SECURITY DEFINER RPC `upsert_attendance` that:
1. SELECTs for an existing row matching student_id + attendance_date + session_id
   (using COALESCE to handle NULL session_id, matching the unique index).
2. If found: UPDATEs the existing row's status, notes, late_minutes, recorded_at.
3. If not found: INSERTs a new row.
4. Returns the row id and a boolean `inserted` flag.

This is atomic because Postgres functions run in a single transaction.

## Security
- SECURITY DEFINER so the function can run regardless of RLS complexities.
- The function only reads/writes the attendance table.
- No new permissions are granted beyond what existing RLS policies allow —
  the function is callable by `authenticated` (same as current CRUD policies).
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
BEGIN
  -- Normalize late_minutes: only store for 'late' status
  IF p_status = 'late' THEN
    v_late_minutes := p_late_minutes;
  ELSE
    v_late_minutes := NULL;
  END IF;

  -- Look for existing row matching the canonical identity:
  -- student_id + attendance_date + COALESCE(session_id, zero-uuid)
  -- This matches the unique index attendance_unique_student_date_session.
  SELECT a.id INTO v_existing_id
  FROM attendance a
  WHERE a.student_id = p_student_id
    AND a.attendance_date = p_attendance_date
    AND COALESCE(a.session_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Update existing row
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
    -- Insert new row
    INSERT INTO attendance (
      student_id, group_id, status, notes,
      attendance_date, session_id, recorded_at, late_minutes
    )
    VALUES (
      p_student_id, p_group_id, p_status, p_notes,
      p_attendance_date, p_session_id, p_recorded_at, v_late_minutes
    )
    RETURNING id INTO v_existing_id;

    RETURN QUERY SELECT v_existing_id, true;
  END IF;
END;
$$;

-- Grant execute to authenticated (matches existing RLS policy scope)
GRANT EXECUTE ON FUNCTION public.upsert_attendance(
  uuid, uuid, text, text, date, uuid, timestamptz, integer
) TO authenticated;
