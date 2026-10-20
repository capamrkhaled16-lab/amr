/*
# Diagnostic Log Table + Archive Run Enhancement

1. New Tables
- `diagnostic_log` — lightweight internal log for confirmed platform failures.
  - `id` (uuid PK)
  - `operation` (text) — e.g. "archive", "save", "sync"
  - `module` (text) — e.g. "homework", "attendance", "payments"
  - `month_key` (text) — the month this failure occurred in
  - `entity_type` (text) — e.g. "homework_status", "center_grades"
  - `error_signature` (text) — short hash/summary of the error type
  - `root_cause` (text) — human-readable root cause
  - `fix_status` (text) — "unverified" | "verified" | "regression_fixed"
  - `created_at` (timestamptz)

2. Security
- RLS enabled on `diagnostic_log`.
- anon + authenticated can read (for diagnostics display) and insert (for logging).
- No delete or update from the client side.

3. Indexes
- Index on `month_key` for month-scoped lookups.
- Index on `fix_status` for regression checking.

4. Notes
- This table is append-only from the client. Deletion is not allowed via RLS.
- The archive engine uses it to check known failure patterns before repeating operations.
*/

CREATE TABLE IF NOT EXISTS diagnostic_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  module text NOT NULL,
  month_key text,
  entity_type text,
  error_signature text NOT NULL,
  root_cause text,
  fix_status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE diagnostic_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_diagnostic_log" ON diagnostic_log;
CREATE POLICY "anon_select_diagnostic_log" ON diagnostic_log FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_diagnostic_log" ON diagnostic_log;
CREATE POLICY "anon_insert_diagnostic_log" ON diagnostic_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_diagnostic_log_month_key ON diagnostic_log(month_key);
CREATE INDEX IF NOT EXISTS idx_diagnostic_log_fix_status ON diagnostic_log(fix_status);
CREATE INDEX IF NOT EXISTS idx_diagnostic_log_error_signature ON diagnostic_log(error_signature);