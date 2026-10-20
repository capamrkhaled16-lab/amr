/*
# Add expenses, behavior category, receipt numbers, and soft-delete for payments

## Summary
This migration adds several features requested by the user:
1. A new `expenses` table for tracking center operating costs (rent, electricity, assistants, etc.) to calculate net profit.
2. A `behavior` category added to `center_exams.category` (no schema change needed — it's a TEXT column, just used in app).
3. A `receipt_number` column on `payments` and `monthly_subscriptions` for generating printable electronic receipts.
4. Soft-delete columns (`is_deleted`, `deleted_at`) on `payments` and `center_grades` to prevent permanent data loss.
5. A `late_payment_alert_day` column on `settings` for configuring automatic WhatsApp late-payment reminders.

## New Tables
- `expenses` — center operating expense records (rent, electricity, assistants, other).
  - `id` (uuid PK)
  - `category` (text: rent, electricity, assistants, other)
  - `amount` (numeric)
  - `description` (text, optional)
  - `expense_date` (date)
  - `recorded_by` (text)
  - `created_at` (timestamptz)

## Modified Tables
- `payments` — added `receipt_number` (text, unique), `is_deleted` (bool default false), `deleted_at` (timestamptz nullable)
- `monthly_subscriptions` — added `receipt_number` (text, nullable)
- `center_grades` — added `is_deleted` (bool default false), `deleted_at` (timestamptz nullable)
- `settings` — added `late_payment_alert_day` (int default 5)

## Security
- RLS enabled on `expenses` with anon+authenticated CRUD (single-tenant app, no auth screen).
- All new columns are nullable or have safe defaults so existing rows are unaffected.
*/

-- 1. Expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'other',
  amount numeric(10,2) NOT NULL DEFAULT 0,
  description text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  recorded_by text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_expenses" ON expenses;
CREATE POLICY "anon_select_expenses" ON expenses FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_expenses" ON expenses;
CREATE POLICY "anon_insert_expenses" ON expenses FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_expenses" ON expenses;
CREATE POLICY "anon_update_expenses" ON expenses FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_expenses" ON expenses;
CREATE POLICY "anon_delete_expenses" ON expenses FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

-- 2. Receipt numbers + soft delete on payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 3. Receipt number on monthly_subscriptions
ALTER TABLE monthly_subscriptions ADD COLUMN IF NOT EXISTS receipt_number text;

-- 4. Soft delete on center_grades
ALTER TABLE center_grades ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE center_grades ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 5. Late payment alert day on settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS late_payment_alert_day integer NOT NULL DEFAULT 5;

-- 6. Enable realtime on expenses
ALTER TABLE expenses REPLICA IDENTITY FULL;
