/*
# Drop obsolete upsert_attendance overload

A previous migration created an upsert_attendance function with a different
signature (6 params, different order). The new version (8 params, with
notes + recorded_at) supersedes it. Drop the old overload to avoid
any call-resolution ambiguity.
*/

DROP FUNCTION IF EXISTS public.upsert_attendance(uuid, uuid, uuid, date, text, integer) CASCADE;
