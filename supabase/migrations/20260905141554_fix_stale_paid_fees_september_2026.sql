-- Fix stale paid_fees for students where paid_fees doesn't match
-- actual current-month (2026-09) payments sum.
-- This resets paid_fees to 0 for students with no actual payments this month
-- but who have leftover paid_fees from a previous month.

UPDATE students s
SET paid_fees = 0
FROM (
  SELECT s2.id
  FROM students s2
  LEFT JOIN (
    SELECT student_id, SUM(amount) as actual_paid
    FROM payments
    WHERE month_key = '2026-09'
      AND is_deleted = false
      AND is_historical_payment = false
      AND amount > 0
    GROUP BY student_id
  ) pay ON pay.student_id = s2.id
  WHERE s2.status = 'active'
    AND COALESCE(s2.paid_fees, 0) != 0
    AND COALESCE(pay.actual_paid, 0) = 0
) stale
WHERE s.id = stale.id;
