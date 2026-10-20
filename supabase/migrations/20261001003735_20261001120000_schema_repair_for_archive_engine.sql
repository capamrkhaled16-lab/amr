/*
# Schema Repair for Archive Engine

## Purpose
Repairs missing schema dependencies that cause the monthly archive engine to crash with HTTP 500.
All changes are idempotent — safe to re-run without creating duplicates.

## Key Finding
`hall_of_fame` is a VIEW (not a table) that computes leaderboard data on-the-fly
from attendance, grades, homework, and behavior for the CURRENT month using
`date_trunc('month', now())`. It cannot have columns added to it.
The archive engine must NOT query it directly — instead, the underlying data
(attendance, center_grades, homework_status, behavior_eval) is already archived,
allowing the leaderboard to be reconstructed for any historical month.

## Changes

### 1. Create `group_transfer_history` table (if not exists)
- Tracks student transfers between groups with exact IDs and timestamps

### 2. Add `created_at` to `certificates` (if missing)
- Required by archive engine to filter certificates by month
- Defaults to now() for existing rows, backfilled from issued_at

### 3. Add `group_id` to `expenses` (if missing)
- Required for group-scoped expense tracking in archive

### 4. Add archive lookup indexes (all idempotent)
- Indexes on date columns used for month-scoped archive queries

### 5. RLS on group_transfer_history
- Enable RLS with anon+authenticated access

### 6. Notify PostgREST schema cache reload
*/

-- ============================================================
-- 1. Create group_transfer_history table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.group_transfer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  to_group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE SET NULL,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  month_key text NOT NULL,
  reason text,
  transferred_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_transfer_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_group_transfer_history" ON public.group_transfer_history;
CREATE POLICY "anon_select_group_transfer_history" ON public.group_transfer_history
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_group_transfer_history" ON public.group_transfer_history;
CREATE POLICY "anon_insert_group_transfer_history" ON public.group_transfer_history
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_group_transfer_history" ON public.group_transfer_history;
CREATE POLICY "anon_update_group_transfer_history" ON public.group_transfer_history
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_group_transfer_history" ON public.group_transfer_history;
CREATE POLICY "anon_delete_group_transfer_history" ON public.group_transfer_history
  FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 2. Add created_at to certificates (if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'certificates' AND column_name = 'created_at') THEN
    ALTER TABLE public.certificates ADD COLUMN created_at timestamptz DEFAULT now();
    UPDATE public.certificates SET created_at = issued_at WHERE created_at IS NULL;
  END IF;
END $$;

-- ============================================================
-- 3. Add group_id to expenses (if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'group_id') THEN
    ALTER TABLE public.expenses ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 4. Add archive lookup indexes (idempotent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_certificates_created_at ON public.certificates (created_at);
CREATE INDEX IF NOT EXISTS idx_center_grades_updated_at ON public.center_grades (updated_at);
CREATE INDEX IF NOT EXISTS idx_behavior_eval_eval_date ON public.behavior_eval (eval_date);
CREATE INDEX IF NOT EXISTS idx_homework_due_date ON public.homework (due_date);
CREATE INDEX IF NOT EXISTS idx_homework_status_recorded_at ON public.homework_status (recorded_at);
CREATE INDEX IF NOT EXISTS idx_attendance_attendance_date ON public.attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_sessions_session_date_group ON public.sessions (session_date, group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfer_history_created_at ON public.group_transfer_history (created_at);
CREATE INDEX IF NOT EXISTS idx_group_transfer_history_month_key ON public.group_transfer_history (month_key);

-- ============================================================
-- 5. Refresh PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
