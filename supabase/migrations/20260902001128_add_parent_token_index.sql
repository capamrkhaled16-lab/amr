-- Add an index on students.parent_token for fast parent portal lookups.
-- The parent portal queries students by parent_token on every page load;
-- without an index this is a full table scan.
CREATE INDEX IF NOT EXISTS idx_students_parent_token ON public.students (parent_token);