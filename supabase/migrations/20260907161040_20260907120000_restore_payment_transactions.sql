/*
# Restore one-row-per-payment transaction history

1. Purpose
- Preserve every payment as its own transaction so the actual payment date and receipt remain accurate.
- Prevent later payments from rewriting an earlier transaction and inflating Daily Collection totals.

2. Modified objects
- `payments`: remove the monthly student uniqueness constraint that prevented multiple transaction rows.
- Existing rows are not deleted, changed, or reset.

3. Data integrity
- The existing primary key continues to provide a unique payment ID for every transaction.
- Future payment totals are calculated by summing active payment transactions for the relevant month.

4. Security
- No tables, columns, or row-level security policies are changed.
*/

DROP INDEX IF EXISTS idx_payments_student_month_unique;

CREATE INDEX IF NOT EXISTS idx_payments_student_month_active
  ON payments (student_id, month_key)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_payments_payment_date_active
  ON payments (payment_date)
  WHERE is_deleted = false;
