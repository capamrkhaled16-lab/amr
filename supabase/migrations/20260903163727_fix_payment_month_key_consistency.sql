-- Fix data inconsistency: sync month_key to match payment_date month for all records
-- This ensures the parent portal month filter works identically for every student

-- 1. Set month_key for the 1 record that has NULL
UPDATE payments
SET month_key = to_char(payment_date::date, 'YYYY-MM')
WHERE month_key IS NULL AND is_deleted = false;

-- 2. Fix the 11 records where month_key doesn't match payment_date's month
UPDATE payments
SET month_key = to_char(payment_date::date, 'YYYY-MM')
WHERE month_key IS NOT NULL
  AND month_key != to_char(payment_date::date, 'YYYY-MM')
  AND is_deleted = false;

-- 3. Verify the fix (should return 0)
-- SELECT COUNT(*) FROM payments WHERE is_deleted = false AND (month_key IS NULL OR month_key != to_char(payment_date::date, 'YYYY-MM'));
