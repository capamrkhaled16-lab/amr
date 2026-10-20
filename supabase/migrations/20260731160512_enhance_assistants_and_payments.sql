/*
# Enhance assistants + add payments tracking

## Overview
1. Adds login tracking and granular permissions to the `assistants` table.
2. Adds a `payments` table to track individual student payment transactions (not just a running balance).
3. Updates the `assistants` RLS policies (already open to anon, no change needed).

## Changes to `assistants`
- `logins_count` (int, default 0) — incremented on each assistant login.
- `last_login_at` (timestamptz, nullable) — timestamp of last login.
- `display_name` already exists; reused.
- Permission columns (booleans, default false):
  - `can_view_finance` — see financial data.
  - `can_edit_grades` — modify grades.
  - `can_manage_attendance` — mark attendance.
  - `can_manage_students` — add/edit/delete students.
  - `can_manage_exams` — create/edit exams.

## New table: `payments`
- Tracks individual payment transactions per student.
- `id`, `student_id`, `amount`, `payment_date`, `note`, `created_at`.
- RLS enabled, open to anon/authenticated (single-tenant platform).

## Notes
- All additions are additive — no data loss.
- `logins_count` and `last_login_at` are updated by the frontend on each assistant login.
*/

-- Add assistant tracking + permission columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'logins_count') THEN
    ALTER TABLE assistants ADD COLUMN logins_count int NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'last_login_at') THEN
    ALTER TABLE assistants ADD COLUMN last_login_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_finance') THEN
    ALTER TABLE assistants ADD COLUMN can_view_finance boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_edit_grades') THEN
    ALTER TABLE assistants ADD COLUMN can_edit_grades boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_manage_attendance') THEN
    ALTER TABLE assistants ADD COLUMN can_manage_attendance boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_manage_students') THEN
    ALTER TABLE assistants ADD COLUMN can_manage_students boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_manage_exams') THEN
    ALTER TABLE assistants ADD COLUMN can_manage_exams boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pay_select" ON payments;
CREATE POLICY "pay_select" ON payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "pay_insert" ON payments;
CREATE POLICY "pay_insert" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pay_update" ON payments;
CREATE POLICY "pay_update" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "pay_delete" ON payments;
CREATE POLICY "pay_delete" ON payments FOR DELETE TO anon, authenticated USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_assistants_username ON assistants(username);
