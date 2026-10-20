-- Performance indexes for archive historical queries
CREATE INDEX IF NOT EXISTS idx_monthly_archives_group_month ON monthly_archives(archive_month);
CREATE INDEX IF NOT EXISTS idx_monthly_archives_status_month ON monthly_archives(status, archive_month);

-- Index for payments by month_key for aggregate queries
CREATE INDEX IF NOT EXISTS idx_payments_month_key ON payments(month_key) WHERE is_deleted = false;

-- Index monthly_subscriptions by student + status for fast overdue queries
CREATE INDEX IF NOT EXISTS idx_monthly_subscriptions_student_status ON monthly_subscriptions(student_id, status);

-- Enable realtime for center_exams so parent portal sees max_score changes instantly
ALTER TABLE center_exams REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE center_exams;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- attendance is already in supabase_realtime; just set replica identity
ALTER TABLE attendance REPLICA IDENTITY FULL;
