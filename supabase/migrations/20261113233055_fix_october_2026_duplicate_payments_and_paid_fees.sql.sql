-- CRITICAL: Fix October 2026 financial audit
-- 1. Soft-delete 3 duplicate historical payment rows (keep the older one)
-- 2. Recalculate students.paid_fees to include historical payments for October
-- 3. Ensure monthly_subscriptions status matches actual payment totals

-- Step 1: Soft-delete duplicate October payments (keep older, mark newer as deleted)
UPDATE payments
SET is_deleted = true,
    deleted_at = now()
WHERE id IN (
  'ba2418a7-a4f8-4b5d-bcea-14cf085ee671',
  'cad3201e-691c-4084-9398-3b008f06b5bb',
  'd26b33a9-f055-4d8e-8c2d-34aeec515258'
);

-- Step 2: Recalculate paid_fees for ALL active students to include
-- historical payments (late payments) for their respective months.
-- This fixes the 37 students who show paid_fees=0 despite having
-- historical payment rows for October.
UPDATE students s
SET paid_fees = COALESCE(
  (SELECT SUM(p.amount)
   FROM payments p
   WHERE p.student_id = s.id
     AND p.month_key = '2026-10'
     AND p.is_deleted = false
     AND p.amount > 0
  ),
  0
)
WHERE s.status = 'active'
  AND EXISTS (
    SELECT 1 FROM monthly_subscriptions ms
    WHERE ms.student_id = s.id AND ms.month_key = '2026-10'
  );

-- Step 3: Recalculate monthly_subscriptions status for October
-- to match actual payment totals (including historical payments)
UPDATE monthly_subscriptions ms
SET
  amount_paid = LEAST(ms.amount_due, COALESCE(
    (SELECT SUM(p.amount)
     FROM payments p
     WHERE p.student_id = ms.student_id
       AND p.month_key = '2026-10'
       AND p.is_deleted = false
       AND p.amount > 0
    ),
    0
  )),
  status = CASE
    WHEN COALESCE(
      (SELECT SUM(p.amount)
       FROM payments p
       WHERE p.student_id = ms.student_id
         AND p.month_key = '2026-10'
         AND p.is_deleted = false
         AND p.amount > 0
      ),
      0
    ) <= 0 THEN 'unpaid'
    WHEN COALESCE(
      (SELECT SUM(p.amount)
       FROM payments p
       WHERE p.student_id = ms.student_id
         AND p.month_key = '2026-10'
         AND p.is_deleted = false
         AND p.amount > 0
      ),
      0
    ) >= ms.amount_due THEN 'paid'
    ELSE 'partial'
  END,
  paid_date = CASE
    WHEN COALESCE(
      (SELECT SUM(p.amount)
       FROM payments p
       WHERE p.student_id = ms.student_id
         AND p.month_key = '2026-10'
         AND p.is_deleted = false
         AND p.amount > 0
      ),
      0
    ) >= ms.amount_due THEN COALESCE(ms.paid_date, now())
    ELSE NULL
  END
WHERE ms.month_key = '2026-10'
  AND EXISTS (SELECT 1 FROM students s WHERE s.id = ms.student_id AND s.status = 'active');
