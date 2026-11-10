/*
# Create archive financial exclusions

1. New Table
- `archive_financial_exclusions`
  - `id` (uuid, primary key)
  - `student_id` (uuid, references students)
  - `month_key` (text, the accounting month the exclusion applies to, format YYYY-MM)
  - `reason` (text, optional note from the staff member)
  - `excluded_at` (timestamptz, when the exclusion was made)
  - `restored_at` (timestamptz, set if the exclusion is later reverted)

2. Behaviour
- Excluding a student removes them from that month's unpaid list and totals only.
- The student record, payments, receipts, attendance, and grades are not touched.
- Rows are never deleted. Reverting sets `restored_at`, which keeps an audit trail.
- At most one active exclusion per student per month (partial unique index).

3. Security
- RLS enabled. Policies for select, insert, and update only; no delete policy.
- Grants limited to anon and authenticated, matching the other financial tables.
*/

CREATE TABLE IF NOT EXISTS archive_financial_exclusions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
student_id uuid NOT NULL REFERENCES students(id),
month_key text NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
reason text,
excluded_at timestamptz NOT NULL DEFAULT now(),
restored_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS archive_financial_exclusions_active_unique
ON archive_financial_exclusions (student_id, month_key)
WHERE restored_at IS NULL;

CREATE INDEX IF NOT EXISTS archive_financial_exclusions_month_idx
ON archive_financial_exclusions (month_key);

ALTER TABLE archive_financial_exclusions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON archive_financial_exclusions TO anon, authenticated;

DROP POLICY IF EXISTS "afe_select" ON archive_financial_exclusions;
CREATE POLICY "afe_select" ON archive_financial_exclusions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "afe_insert" ON archive_financial_exclusions;
CREATE POLICY "afe_insert" ON archive_financial_exclusions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "afe_update" ON archive_financial_exclusions;
CREATE POLICY "afe_update" ON archive_financial_exclusions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);
