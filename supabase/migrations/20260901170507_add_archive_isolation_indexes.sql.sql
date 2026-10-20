-- Compound index for monthly_subscriptions: student + month_key + status
-- Speeds up overdue queries that filter by student and month simultaneously
CREATE INDEX IF NOT EXISTS idx_monthly_subscriptions_student_month_status
  ON monthly_subscriptions(student_id, month_key, status);

-- Index for payments by student + month_key + is_deleted for fast archive lookups
CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON payments(student_id, month_key) WHERE is_deleted = false;

-- GIN index on archive_data JSONB for faster key lookups within snapshots
CREATE INDEX IF NOT EXISTS idx_monthly_archives_archive_data_gin
  ON monthly_archives USING GIN (archive_data jsonb_path_ops);

-- Index carried_over_balances by from_month for rollback cleanup
CREATE INDEX IF NOT EXISTS idx_carried_over_balances_from_month
  ON carried_over_balances(from_month);
