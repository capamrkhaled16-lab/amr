/*
# Next session number function

## Purpose
Provides a reliable, race-free way to compute the next session number for a
group. The old frontend code used `sessions.length + 1`, which produces
duplicate numbers after sessions are deleted or archived.

This function counts the MAX session number ever used for a group (even
deleted/archived ones) by parsing the title pattern, and returns the next
integer. If no numbered sessions exist, it returns 1.

## Usage
  SELECT next_session_number('group-uuid');
  -- or via RPC: supabase.rpc('next_session_number', { p_group_id: '...' })

## Security
- SECURITY DEFINER function, read-only.
- No data modifications.
- No RLS changes.
*/

CREATE OR REPLACE FUNCTION next_session_number(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_num integer := 0;
  extracted integer;
  r record;
BEGIN
  FOR r IN
    SELECT title FROM sessions WHERE group_id = p_group_id
  LOOP
    BEGIN
      -- Extract trailing integer from titles like "الحصة 3" or "حصة 12"
      extracted := substring(r.title FROM '([0-9]+)\s*$')::integer;
      IF extracted > max_num THEN
        max_num := extracted;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- title doesn't end with a number; skip
      CONTINUE;
    END;
  END LOOP;

  RETURN max_num + 1;
END;
$$;

-- Grant execute to anon and authenticated (app uses anon key)
GRANT EXECUTE ON FUNCTION next_session_number(uuid) TO anon, authenticated;
