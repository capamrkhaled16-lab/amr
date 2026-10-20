/*
# Add Group Transfer History Table + Enrollment Timestamp

1. New Tables
- `group_transfers`
  - `id` (uuid, primary key)
  - `student_id` (uuid, references students.id)
  - `from_group_id` (uuid, references groups.id, nullable for first enrollment)
  - `to_group_id` (uuid, references groups.id)
  - `transferred_at` (timestamptz, default now())
  - `actor_name` (text, who performed the transfer)
2. Modified Tables
- `students.enrollment_date` — change default to `now()` so new students get a full timestamp automatically
3. Security
- Enable RLS on `group_transfers`
- Allow anon + authenticated CRUD (single-tenant app, no sign-in screen)
4. Notes
- The enrollment_date column already exists; we only set a default so future inserts capture the exact timestamp
- group_transfers tracks every time a student moves between groups for parent portal visibility
*/

CREATE TABLE IF NOT EXISTS group_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  to_group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  actor_name text DEFAULT 'النظام'
);

ALTER TABLE group_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_group_transfers" ON group_transfers;
CREATE POLICY "anon_select_group_transfers" ON group_transfers FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_group_transfers" ON group_transfers;
CREATE POLICY "anon_insert_group_transfers" ON group_transfers FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_group_transfers" ON group_transfers;
CREATE POLICY "anon_update_group_transfers" ON group_transfers FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_group_transfers" ON group_transfers;
CREATE POLICY "anon_delete_group_transfers" ON group_transfers FOR DELETE
  TO anon, authenticated USING (true);

-- Set default enrollment_date to now() for future inserts
ALTER TABLE students ALTER COLUMN enrollment_date SET DEFAULT now();

-- Enable realtime for group_transfers
ALTER TABLE group_transfers REPLICA IDENTITY FULL;
