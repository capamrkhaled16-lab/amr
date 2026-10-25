/*
# Restore missing payment receipt columns

## Why
The SubscriptionsModule payment flow (partial payment, full payment, manual
WhatsApp receipt) is broken because the `payments` table is missing the columns
the application code writes/reads: `receipt_number`, `recorded_by`, `recorded_at`,
`month_key`, `is_deleted`, `deleted_at`, `idempotency_key`,
`is_historical_payment`, `target_archive_month`. Without these columns every
payment INSERT fails, `paySubscription` returns null, `lastReceipt` is never
set, and the receipt confirmation modal never opens. The manual WhatsApp button
also fails because it queries `receipt_number`/`recorded_by`/`month_key` which
do not exist.

The `monthly_subscriptions` table is missing `receipt_number`, `is_exempt`, and
`exemption_note`, which the code reads/writes when recording a payment and
building the receipt.

The `students` table is missing `is_exempt` and `discount_amount`, which
`resolvePaymentSnapshot` and `ensureMonthlySubscriptions` read.

## Changes

### payments (additive only — no existing column touched)
1. `receipt_number` text — generated receipt number for the payment.
2. `recorded_by` text — who collected the payment.
3. `recorded_at` timestamptz — when the payment was recorded.
4. `month_key` text — the month the payment is attributed to (YYYY-MM).
5. `is_deleted` boolean default false — soft delete flag.
6. `deleted_at` timestamptz — when the payment was soft-deleted.
7. `idempotency_key` text — dedup key for duplicate payment prevention.
8. `is_historical_payment` boolean default false — marks historical/archived payments.
9. `target_archive_month` text — the archive month a historical payment targets.

### monthly_subscriptions (additive only)
1. `receipt_number` text — the receipt number of the latest payment for this subscription.
2. `is_exempt` boolean default false — whether the student is exempt from fees this month.
3. `exemption_note` text — optional note explaining the exemption.

### students (additive only)
1. `is_exempt` boolean default false — whether the student is exempt from fees.
2. `discount_amount` numeric default 0 — a per-student discount on the base fee.

## Indexes
- `idx_payments_month_key` on `payments(month_key)` for month-scoped queries.
- `idx_payments_student_month` on `payments(student_id, month_key)` for the snapshot.
- `idx_payments_idempotency` on `payments(idempotency_key)` for dedup lookups.
- `idx_payments_receipt_number` on `payments(receipt_number)` for receipt retrieval.
- `idx_monthly_subs_student_month` on `monthly_subscriptions(student_id, month_key)`.

## Security
- RLS is already enabled on `payments` and `monthly_subscriptions` with
  open CRUD policies for `anon, authenticated` (single-tenant app, no sign-in
  required for this platform's dashboard). No policy changes needed.
- Existing grants already cover the new columns (column-level grants are not
  in use here; table-level grants apply to all columns).
- No data is deleted, renamed, or type-changed. All changes are additive.
*/

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
