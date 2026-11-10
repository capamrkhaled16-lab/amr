/*
# Fix student profile archive sync trigger

1. Problem
- Updating any student row failed with "malformed array literal" because the trigger
  passed bare names such as 'phone' to jsonb_set instead of text path arrays.

2. Change
- The trigger function now uses text[] paths ('{phone}', '{parent_phone}', '{name}',
  '{gender}', '{status}'). Its logic is otherwise unchanged.

3. Security
- No table, policy, or grant changes.

4. Notes
- Only archived student snapshots containing the student are updated, as before.
*/

CREATE OR REPLACE FUNCTION public.sync_student_profile_to_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
UPDATE monthly_archives
SET
archive_data = jsonb_set(
archive_data,
'{students}',
(
SELECT jsonb_agg(
CASE
WHEN elem->>'id' = NEW.id::text THEN
jsonb_set(
jsonb_set(
jsonb_set(
jsonb_set(
jsonb_set(
elem,
'{phone}', to_jsonb(NEW.phone)
),
'{parent_phone}', to_jsonb(NEW.parent_phone)
),
'{name}', to_jsonb(NEW.name)
),
'{gender}', to_jsonb(NEW.gender)
),
'{status}', to_jsonb(NEW.status)
)
ELSE elem
END
)
FROM jsonb_array_elements(archive_data->'students') AS elem
),
true
),
updated_at = now()
WHERE archive_data->'students' @> jsonb_build_array(jsonb_build_object('id', NEW.id::text));

RETURN NEW;
END;
$function$;
