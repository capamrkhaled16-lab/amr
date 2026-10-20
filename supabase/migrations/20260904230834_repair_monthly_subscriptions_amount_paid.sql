-- Repair: Sync monthly_subscriptions.amount_paid with actual payments
-- For archived month 2026-08, monthly_subscriptions.amount_paid was stuck at 0
-- even though students had real payments in the payments table.
-- This updates amount_paid and status to reflect reality.
-- Does NOT touch the payments table, archive JSON, parent tokens, or month structure.

UPDATE monthly_subscriptions ms
SET amount_paid = COALESCE(paid.total, 0),
    status = CASE
      WHEN COALESCE(paid.total, 0) >= ms.amount_due THEN 'paid'
      WHEN COALESCE(paid.total, 0) > 0 THEN 'partial'
      ELSE 'unpaid'
    END,
    paid_date = CASE
      WHEN COALESCE(paid.total, 0) > 0 AND ms.paid_date IS NULL THEN paid.latest_date
      ELSE ms.paid_date
    END
FROM (
  SELECT student_id, month_key,
    SUM(amount) as total,
    MAX(payment_date) as latest_date
  FROM payments
  WHERE is_deleted = false
  GROUP BY student_id, month_key
) paid
WHERE ms.student_id = paid.student_id
  AND ms.month_key = paid.month_key
  AND COALESCE(paid.total, 0) > ms.amount_paid;
