/*
# Atomic automatic session creation

1. Changes
- Add `create_session_auto` database function.
- The function determines the next session number inside a transaction-safe
  advisory lock for the selected group, then inserts and returns the new row.
- Existing sessions, including archived or deleted rows, remain untouched and
  continue to determine the next number.

2. User-visible behavior
- New sessions are automatically named `الحصة N` when no custom title is
  supplied.
- The date remains editable through the existing date picker.
- Concurrent creation from multiple devices cannot reuse the same number.

3. Security
- The function is SECURITY DEFINER with a fixed public search path.
- Execute is granted to the same application roles already used by the app.
- No existing data, columns, or session numbers are changed.
*/

CREATE OR REPLACE FUNCTION create_session_auto(
  p_group_id uuid,
  p_month text,
  p_session_date date,
  p_title text DEFAULT NULL
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number integer;
  generated_title text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_group_id::text));

  SELECT COALESCE(MAX((match[1])::integer), 0) + 1
  INTO next_number
  FROM sessions s
  CROSS JOIN LATERAL regexp_matches(s.title, '([0-9]+)\\s*$') AS match
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
$$;

GRANT EXECUTE ON FUNCTION create_session_auto(uuid, text, date, text) TO anon, authenticated;
