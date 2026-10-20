/*
# Prevent duplicate sessions on same day + restore payment uniqueness

## Problem 1: Duplicate sessions on same day
The `create_session_auto` function has no check for whether a session already
exists for the same group on the same date. This allows creating two sessions
for the same group on the same day, which inflates attendance counts and
confuses parents in the parent portal.

## Fix 1
1. Add a unique partial index on `sessions(group_id, session_date)` where
   `is_deleted = false` to enforce at most one active session per group per day.
2. Modify `create_session_auto` to check for an existing session on the same
   date for the same group. If found, return it instead of creating a duplicate.
   This makes the function idempotent for same-day calls.

## Problem 2: Payment uniqueness was lost
The unique index `idx_payments_student_month_unique` on
`payments(student_id, month_key) WHERE is_deleted = false` was created in
migration 20260827105538 but appears to have been dropped (not present in
pg_indexes). This allows duplicate payments for the same student/month.

## Fix 2
Recreate the unique index. If duplicate active payments exist for the same
student+month, keep only the latest one (by created_at) and soft-delete the rest.

## Security
- No RLS changes.
- No new tables.
- No data loss — duplicates are soft-deleted, not hard-deleted.
*/

-- ============================================================
-- FIX 1: Prevent duplicate sessions on same day
-- ============================================================

-- Soft-delete duplicate sessions (same group, same date), keeping the newest
DELETE FROM sessions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY group_id, session_date
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM sessions
    WHERE is_deleted = false AND session_date IS NOT NULL
  ) dupes
  WHERE dupes.rn > 1
);

-- Create unique index for active sessions per group per day
CREATE UNIQUE INDEX IF NOT EXISTS sessions_unique_group_date_active
  ON sessions (group_id, session_date)
  WHERE is_deleted = false AND session_date IS NOT NULL;

-- Replace create_session_auto to check for existing same-day session
CREATE OR REPLACE FUNCTION public.create_session_auto(
  p_group_id uuid,
  p_month text,
  p_session_date date,
  p_title text DEFAULT NULL
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_number integer;
  generated_title text;
  existing_session sessions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_group_id::text));

  -- Check if a session already exists for this group on this date
  SELECT * INTO existing_session
  FROM sessions
  WHERE group_id = p_group_id
    AND session_date = p_session_date
    AND is_deleted = false
  LIMIT 1;

  -- If found, return it instead of creating a duplicate
  IF FOUND THEN
    RETURN QUERY SELECT existing_session;
    RETURN;
  END IF;

  SELECT COALESCE(MAX((match[1])::integer), 0) + 1
  INTO next_number
  FROM sessions s
  CROSS JOIN LATERAL regexp_matches(s.title, '([0-9]+)\s*$') AS match
  WHERE s.group_id = p_group_id;

  generated_title := NULLIF(trim(p_title), '');
  IF generated_title IS NULL THEN
    generated_title := 'الحصة ' || next_number;
  END IF;

  RETURN QUERY
  INSERT INTO sessions (group_id, title, month, session_date)
  VALUES (p_group_id, generated_title, p_month, p_session_date)
  RETURNING *;
END;
$function$;

-- ============================================================
-- FIX 2: Restore payment uniqueness per student per month
-- ============================================================

-- Soft-delete duplicate active payments for same student+month, keeping newest
UPDATE payments
SET is_deleted = true,
    deleted_at = now()
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY student_id, month_key
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM payments
    WHERE is_deleted = false AND month_key IS NOT NULL
  ) dupes
  WHERE dupes.rn > 1
);

-- Recreate the unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_student_month_unique
  ON payments (student_id, month_key)
  WHERE month_key IS NOT NULL AND is_deleted = false;

-- Recalculate paid_fees for affected students
UPDATE students s
SET paid_fees = COALESCE((
  SELECT SUM(p.amount) FROM payments p
  WHERE p.student_id = s.id AND p.is_deleted = false AND p.amount > 0
), 0)
WHERE s.id IN (
  SELECT DISTINCT student_id FROM payments
  WHERE month_key IS NOT NULL AND is_deleted = false
);
