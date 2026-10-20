/*
# Payment Idempotency & Soft-Delete Support

## Purpose
Prevent duplicate payments at the database level and enable safe edit/delete of payment transactions in the Daily Collector.

## Changes

### 1. New column: `idempotency_key` on `payments`
- `idempotency_key text` — a client-generated unique key per payment intent (student_id + amount + timestamp window).
- When a duplicate request arrives with the same key, the unique index rejects the second insert.
- Nullable for backward compatibility with existing rows.

### 2. Unique index: `idx_payments_idempotency_key`
- `UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL`
- Partial unique index so existing NULL rows don't conflict.

### 3. Soft-delete already supported
- The `is_deleted` and `deleted_at` columns already exist on `payments`.
- `deletePaymentWithAudit` currently hard-deletes rows. We will change the frontend to use soft-delete instead.

### Security
- No RLS policy changes — existing policies remain intact.
- No data loss — all existing payments keep their data.

### Notes
1. The `idempotency_key` is generated client-side as `student_id:amount:month_key:minute_bucket` where minute_bucket is the current minute. Two requests within the same minute for the same student+amount+month are treated as duplicates and rejected by the database.
2. Legitimate separate payments (different amounts, or different minutes) are not affected.
3. Historical payments use a different key pattern: `hist:student_id:amount:target_month:minute_bucket`.
*/

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
