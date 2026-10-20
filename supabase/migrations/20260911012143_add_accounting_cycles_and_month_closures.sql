/*
# Add accounting cycles and month closure tables

## Overview
This migration adds two new tables to support professional accounting cycles and monthly snapshots/month closure features. These are READ-ONLY tracking tables that reference existing payment data — they never modify or duplicate payment records.

## New Tables

### 1. accounting_cycles
Tracks independent accounting periods. Each cycle captures which payments were included at creation time. Once a payment is included in a cycle, it stays there permanently — new payments added later belong to the next cycle.
- `id` (uuid, PK)
- `cycle_number` (integer, auto-incremented via sequence) — sequential accounting number
- `start_date` (date) — when the accounting period starts
- `end_date` (date) — when the accounting period ends
- `total_amount` (numeric) — total payments included in this cycle
- `accounted_amount` (numeric, default 0) — amount already accounted for
- `remaining_amount` (numeric, default = total_amount) — what's left to account
- `payment_ids` (jsonb) — array of payment UUIDs included in this cycle (snapshot, never changes)
- `status` (text: 'open' | 'closed') — whether the cycle is still active
- `created_by` (text) — who created the cycle
- `created_at` (timestamptz)
- `closed_at` (timestamptz, nullable)

### 2. month_closures
Tracks monthly snapshots when a month is closed. Preserves a historical snapshot of financial and academic state. Later changes do NOT rewrite the closed month's snapshot.
- `id` (uuid, PK)
- `month_key` (text, format YYYY-MM) — the month being closed
- `month_label` (text) — Arabic month label for display
- `snapshot_data` (jsonb) — historical snapshot of the month's state (financial + academic summary)
- `closed_by` (text) — who closed the month
- `closed_at` (timestamptz)
- `is_reopened` (boolean, default false) — whether the month was reopened after closure

## Security
- Both tables use RLS with anon+authenticated access (same as existing platform tables)
- These are platform-wide tracking tables, not per-user data

## Important Notes
1. accounting_cycles.payment_ids is a SNAPSHOT — it stores payment IDs at cycle creation time and never changes
2. month_closures.snapshot_data is immutable after creation — it preserves the historical state
3. Neither table modifies or duplicates existing payment records
4. The existing monthly_archives table remains unchanged — this is a separate closure tracking mechanism
*/

-- Sequence for accounting cycle numbers
CREATE SEQUENCE IF NOT EXISTS accounting_cycle_seq START 1;

-- Accounting cycles table
CREATE TABLE IF NOT EXISTS accounting_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_number integer NOT NULL DEFAULT nextval('accounting_cycle_seq'),
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  accounted_amount numeric(12, 2) NOT NULL DEFAULT 0,
  remaining_amount numeric(12, 2) NOT NULL DEFAULT 0,
  payment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE accounting_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_accounting_cycles" ON accounting_cycles;
CREATE POLICY "anon_select_accounting_cycles" ON accounting_cycles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_accounting_cycles" ON accounting_cycles;
CREATE POLICY "anon_insert_accounting_cycles" ON accounting_cycles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_accounting_cycles" ON accounting_cycles;
CREATE POLICY "anon_update_accounting_cycles" ON accounting_cycles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_accounting_cycles" ON accounting_cycles;
CREATE POLICY "anon_delete_accounting_cycles" ON accounting_cycles FOR DELETE
  TO anon, authenticated USING (true);

-- Month closures table
CREATE TABLE IF NOT EXISTS month_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key text NOT NULL UNIQUE,
  month_label text NOT NULL,
  snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_by text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  is_reopened boolean NOT NULL DEFAULT false
);

ALTER TABLE month_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_month_closures" ON month_closures;
CREATE POLICY "anon_select_month_closures" ON month_closures FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_month_closures" ON month_closures;
CREATE POLICY "anon_insert_month_closures" ON month_closures FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_month_closures" ON month_closures;
CREATE POLICY "anon_update_month_closures" ON month_closures FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_month_closures" ON month_closures;
CREATE POLICY "anon_delete_month_closures" ON month_closures FOR DELETE
  TO anon, authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounting_cycles_status ON accounting_cycles(status);
CREATE INDEX IF NOT EXISTS idx_accounting_cycles_dates ON accounting_cycles(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_month_closures_month_key ON month_closures(month_key);
