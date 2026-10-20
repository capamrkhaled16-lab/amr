/*
# Monthly Subscriptions System & Base Subscription Fee

1. New Columns
- `academic_stages.base_subscription` (numeric, default 0): the fixed monthly subscription
  amount for each academic stage. This replaces the need to manually enter the amount per student.
  When adding students or generating monthly subscription records, this value is used automatically.

2. New Tables
- `monthly_subscriptions`: tracks each student's subscription payment status per month.
  - `id` (uuid, primary key)
  - `student_id` (uuid, FK → students.id): the student
  - `month` (text): month label in Arabic format, e.g. "أكتوبر 2026"
  - `month_key` (text): sortable month key, e.g. "2026-10"
  - `amount_due` (numeric): the base subscription amount for this student's stage
  - `amount_paid` (numeric, default 0): how much has been paid for this month
  - `status` (text): 'unpaid' | 'partial' | 'paid' | 'late_paid'
    - 'unpaid': nothing paid yet
    - 'partial': some amount paid but not full
    - 'paid': fully paid within the month
    - 'late_paid': paid after the month ended (retroactive payment)
  - `paid_date` (timestamptz, nullable): when the payment was recorded
  - `is_archived` (boolean, default false): if the month has ended and the student
    hasn't paid, the record is archived as debt (arrears)
  - `note` (text, nullable)
  - `recorded_by` (text, nullable): who recorded the payment
  - `created_at` (timestamptz, default now())

3. Security
- Enable RLS on `monthly_subscriptions`.
- Add CRUD policies for `anon, authenticated` since the app uses a shared dashboard
  with internal auth (master PIN / assistant PIN), not Supabase auth.
*/

-- Add base_subscription column to academic_stages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'academic_stages' AND column_name = 'base_subscription'
  ) THEN
    ALTER TABLE academic_stages ADD COLUMN base_subscription numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Create monthly_subscriptions table
CREATE TABLE IF NOT EXISTS monthly_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month text NOT NULL,
  month_key text NOT NULL,
  amount_due numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid',
  paid_date timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  note text,
  recorded_by text,
  created_at timestamptz DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_monthly_subs_student ON monthly_subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_monthly_subs_month_key ON monthly_subscriptions(month_key);
CREATE INDEX IF NOT EXISTS idx_monthly_subs_status ON monthly_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_monthly_subs_archived ON monthly_subscriptions(is_archived);

ALTER TABLE monthly_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_monthly_subs" ON monthly_subscriptions;
CREATE POLICY "anon_select_monthly_subs"
ON monthly_subscriptions FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_monthly_subs" ON monthly_subscriptions;
CREATE POLICY "anon_insert_monthly_subs"
ON monthly_subscriptions FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_monthly_subs" ON monthly_subscriptions;
CREATE POLICY "anon_update_monthly_subs"
ON monthly_subscriptions FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_monthly_subs" ON monthly_subscriptions;
CREATE POLICY "anon_delete_monthly_subs"
ON monthly_subscriptions FOR DELETE
TO anon, authenticated USING (true);
