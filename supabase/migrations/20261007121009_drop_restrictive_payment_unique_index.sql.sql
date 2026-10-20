-- Drop the overly-restrictive unique index that only allowed ONE payment
-- row per student per month. This caused false-positive duplicate errors
-- and forced amount-merging which doubled totals. Multiple payments per
-- student per month are valid (partial payments, installments, etc).
-- The idempotency_key unique index still protects against double-clicks.
DROP INDEX IF EXISTS public.idx_payments_student_month_unique;
