-- payments: additive columns
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS month_key text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_historical_payment boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS target_archive_month text;

-- monthly_subscriptions: additive columns
ALTER TABLE monthly_subscriptions ADD COLUMN IF NOT EXISTS receipt_number text;
ALTER TABLE monthly_subscriptions ADD COLUMN IF NOT EXISTS is_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE monthly_subscriptions ADD COLUMN IF NOT EXISTS exemption_note text;

-- students: additive columns (is_exempt / discount_amount used by snapshot + ensure)
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

-- Indexes for the payment receipt flow
CREATE INDEX IF NOT EXISTS idx_payments_month_key ON payments(month_key);
CREATE INDEX IF NOT EXISTS idx_payments_student_month ON payments(student_id, month_key);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_number ON payments(receipt_number);
CREATE INDEX IF NOT EXISTS idx_monthly_subs_student_month ON monthly_subscriptions(student_id, month_key);
