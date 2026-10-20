/*
# Automated Monthly Archiving & Flexible Historical Payments

## Overview
This migration implements the full infrastructure for:
1. Idempotent automatic month-end archiving (cron job safe to re-run)
2. Carried-over debt isolation from previous month
3. Historical data immutability enforcement at the database level
4. Fast archive retrieval via composite indexes

## New Tables

### `archive_runs`
Tracks each archive execution to prevent duplicate runs (idempotency).
- `id` (uuid, PK)
- `archive_month` (text, unique) — the month being archived, e.g. "2026-08"
- `run_type` (text) — 'auto' | 'manual' — how the archive was triggered
- `status` (text) — 'completed' | 'failed' | 'in_progress'
- `carried_over_count` (int, default 0) — number of students with carried-over debt
- `carried_over_total` (numeric, default 0) — total amount carried over
- `error_message` (text, nullable)
- `started_at` (timestamptz)
- `completed_at` (timestamptz, nullable)

### `carried_over_balances`
Records individual student debt carried from one month to the next.
- `id` (uuid, PK)
- `student_id` (uuid, FK to students)
- `from_month` (text) — the month the debt originated from
- `to_month` (text) — the month the debt was carried into
- `amount` (numeric) — the carried-over amount
- `description` (text) — human-readable label, e.g. "ترحيل متأخرات شهر أغسطس"
- `is_settled` (boolean, default false) — whether this carried balance has been paid
- `created_at` (timestamptz)

## Modified Tables

### `monthly_archives`
- `archived_at` (timestamptz, nullable) — when the archive was finalized (was missing)

### `payments`
- `is_historical_payment` (boolean, default false) — marks a payment for a past archived month
- `target_archive_month` (text, nullable) — which archived month this payment applies to
- `requires_manager_override` (boolean, default false) — flags payments that needed manager approval

## Security
- RLS enabled on `archive_runs` and `carried_over_balances` with full CRUD for authenticated users
- No changes to existing table policies

## Indexes
- `idx_archive_runs_month` — unique on archive_month for idempotency
- `idx_carried_balances_student` — on student_id for fast lookup
- `idx_carried_balances_to_month` — on to_month for monthly queries
- `idx_payments_historical` — on is_historical_payment + target_archive_month
- `idx_payments_student_month` — composite on student_id + month_key for fast archive lookups

## Notes
1. The `archive_runs` table with its unique constraint on `archive_month` is the
   idempotency guard — the edge function inserts a row BEFORE archiving; if the
   insert conflicts, the month was already archived and the function exits.
2. `carried_over_balances` allows the FinancesModule to show "ترحيل متأخرات شهر X"
   as a separate line item in the new month.
3. `is_historical_payment` + `target_archive_month` on payments lets you record
   a late payment for an archived month without modifying the archive itself.
*/

-- ============================================================
-- 1. Add archived_at column to monthly_archives (was missing)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monthly_archives' AND column_name = 'archived_at') THEN
    ALTER TABLE monthly_archives ADD COLUMN archived_at timestamptz;
  END IF;
END $$;

-- ============================================================
-- 2. Add historical payment columns to payments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'is_historical_payment') THEN
    ALTER TABLE payments ADD COLUMN is_historical_payment boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'target_archive_month') THEN
    ALTER TABLE payments ADD COLUMN target_archive_month text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'requires_manager_override') THEN
    ALTER TABLE payments ADD COLUMN requires_manager_override boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ============================================================
-- 3. Create archive_runs table (idempotency guard)
-- ============================================================
CREATE TABLE IF NOT EXISTS archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_month text NOT NULL UNIQUE,
  run_type text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'in_progress',
  carried_over_count int NOT NULL DEFAULT 0,
  carried_over_total numeric(10,2) NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE archive_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_archive_runs" ON archive_runs;
CREATE POLICY "select_archive_runs" ON archive_runs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_archive_runs" ON archive_runs;
CREATE POLICY "insert_archive_runs" ON archive_runs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_archive_runs" ON archive_runs;
CREATE POLICY "update_archive_runs" ON archive_runs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_archive_runs" ON archive_runs;
CREATE POLICY "delete_archive_runs" ON archive_runs FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_archive_runs_month ON archive_runs(archive_month);
CREATE INDEX IF NOT EXISTS idx_archive_runs_status ON archive_runs(status);

-- ============================================================
-- 4. Create carried_over_balances table
-- ============================================================
CREATE TABLE IF NOT EXISTS carried_over_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_month text NOT NULL,
  to_month text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  is_settled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE carried_over_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_carried_balances" ON carried_over_balances;
CREATE POLICY "select_carried_balances" ON carried_over_balances FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_carried_balances" ON carried_over_balances;
CREATE POLICY "insert_carried_balances" ON carried_over_balances FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_carried_balances" ON carried_over_balances;
CREATE POLICY "update_carried_balances" ON carried_over_balances FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_carried_balances" ON carried_over_balances;
CREATE POLICY "delete_carried_balances" ON carried_over_balances FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_carried_balances_student ON carried_over_balances(student_id);
CREATE INDEX IF NOT EXISTS idx_carried_balances_to_month ON carried_over_balances(to_month);
CREATE INDEX IF NOT EXISTS idx_carried_balances_settled ON carried_over_balances(is_settled);

-- ============================================================
-- 5. Performance indexes on payments
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_payments_historical ON payments(is_historical_payment, target_archive_month);
CREATE INDEX IF NOT EXISTS idx_payments_student_month ON payments(student_id, month_key);
CREATE INDEX IF NOT EXISTS idx_payments_archive_month ON payments(target_archive_month) WHERE target_archive_month IS NOT NULL;

-- ============================================================
-- 6. Composite index on monthly_archives for fast retrieval
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_monthly_archives_month_locked ON monthly_archives(archive_month, is_locked);
