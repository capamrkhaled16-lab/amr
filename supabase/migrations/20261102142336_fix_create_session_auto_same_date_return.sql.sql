/*
# Fix session creation when a session already exists for the date

1. Problem
- Creating a session for a group and date that already has a session failed with a database type error.
- The app then showed "تعذّر حفظ الحصة" and the entered lesson number was lost.

2. Change
- Replaces the function create_session_auto with the same signature.
- In the same-date branch, the existing session row is now returned correctly (RETURN NEXT) instead of an invalid column selection.
- No other logic changes: the advisory lock, next-number logic, and insert are unchanged.

3. Security
- Function remains SECURITY DEFINER with the same search_path and existing EXECUTE grants.
- No table, row, payment, or attendance data is modified.

4. Notes
- Calling it again for an existing date returns the existing session and does not create a duplicate.
*/

CREATE OR REPLACE FUNCTION public.create_session_auto(p_group_id uuid, p_month text, p_session_date date, p_title text DEFAULT NULL::text)
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

SELECT * INTO existing_session
FROM sessions
WHERE group_id = p_group_id
AND session_date = p_session_date
AND is_deleted = false
LIMIT 1;

IF FOUND THEN
RETURN NEXT existing_session;
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
