/*
# Fix: New sessions must never be blocked or silently replaced

## Problem
The `create_session_auto` function returned an existing session for the
same group+date instead of creating a new one. Combined with a unique
partial index on `sessions(group_id, session_date) WHERE is_deleted = false`,
this prevented creating more than one session per group per date.
Sessions 2, 3, etc. on the same date were silently lost — the function
returned session 1 and never inserted a new row.

## Fix
1. Drop the unique partial index that limited one session per group per date.
2. Replace `create_session_auto` to always INSERT a new row — no same-date
   return-existing branch. The advisory lock and auto-numbering are preserved.
3. Duplicate prevention is now handled by the application layer (idempotency
   guard) and the `lesson_number` uniqueness within a month, not by blocking
   same-date sessions.

## Security
- Function remains SECURITY DEFINER with fixed search_path = public.
- No table, column, or data changes.
- Existing EXECUTE grants to anon and authenticated are preserved.
*/

-- Drop the unique partial index that blocked multiple sessions per group+date
DROP INDEX IF EXISTS sessions_unique_group_date_active;

-- Replace the function to always create a new session row
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_group_id::text));

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

-- Preserve execute grants
GRANT EXECUTE ON FUNCTION public.create_session_auto(uuid, text, date, text) TO anon, authenticated;
