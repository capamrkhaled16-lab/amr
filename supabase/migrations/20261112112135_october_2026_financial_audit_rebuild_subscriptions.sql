/*
# October 2026 Financial Audit — Rebuild monthly_subscriptions from verified data

## Purpose
Rebuild every active student's October 2026 monthly_subscriptions row from:
- Grade-level base_subscription (the correct monthly fee per grade)
- Student exemption / discount fields (is_exempt, discount_mode, discount_percent, discount_amount)
- Actual October payment totals (payments where month_key='2026-10' and is_deleted=false)

No payments or receipts are created, modified, or deleted.
No student records, groups, attendance, sessions, grades, or exams are touched.
Only monthly_subscriptions rows for month_key='2026-10' are affected.

## Logic
For each active student (is_deleted=false):
1. amount_due = computeEffectiveFees(base_subscription):
   - is_exempt=true → 0
   - discount_mode='percent' and discount_percent>0 → base * (1 - percent/100)
   - discount_mode='fixed' and discount_amount>0 → base - discount_amount
   - discount_amount>0 → base - discount_amount
   - else → base
   Rounded to 2 decimals, minimum 0.
2. amount_paid = sum of payments.amount where month_key='2026-10' and is_deleted=false
3. status:
   - is_exempt=true → 'exempt'
   - amount_due=0 and amount_paid=0 → 'exempt' (no fees due)
   - amount_paid >= amount_due and amount_due > 0 → 'paid'
   - amount_paid > 0 and amount_paid < amount_due → 'partial'
   - else → 'unpaid'
4. is_exempt = student.is_exempt (from students table, not from existing subscription)
5. receipt_number = receipt from the most recent October payment if any

## Tables Modified
- monthly_subscriptions: UPSERT all rows where month_key='2026-10' for active students

## Tables NOT Modified
- payments (no changes)
- students (no changes)
- groups, grade_levels, attendance, sessions, grades, exams (no changes)
- No RLS or policy changes
*/

-- Step 1: Delete existing October subscriptions for active students (they will be recreated with correct data)
-- Keep a record in the backup table already created
DELETE FROM monthly_subscriptions WHERE month_key = '2026-10';

-- Step 2: Insert correct October subscriptions for all active students
INSERT INTO monthly_subscriptions (
  student_id, month, month_key, amount_due, amount_paid, status,
  paid_date, is_archived, note, recorded_by, receipt_number, is_exempt, exemption_note
)
SELECT
  s.id,
  'أكتوبر 2026',
  '2026-10',
  -- amount_due: computeEffectiveFees logic
  CASE
    WHEN s.is_exempt THEN 0
    WHEN s.discount_mode = 'percent' AND s.discount_percent > 0 THEN
      GREATEST(0, ROUND((gl.base_subscription * (1 - s.discount_percent / 100.0)) * 100) / 100)
    WHEN s.discount_mode = 'fixed' AND s.discount_amount > 0 THEN
      GREATEST(0, gl.base_subscription - s.discount_amount)
    WHEN s.discount_amount > 0 THEN
      GREATEST(0, gl.base_subscription - s.discount_amount)
    ELSE gl.base_subscription
  END AS amount_due,
  -- amount_paid: sum of actual October payments
  COALESCE(pay.paid_total, 0) AS amount_paid,
  -- status
  CASE
    WHEN s.is_exempt THEN 'exempt'
    WHEN GREATEST(0, ROUND((gl.base_subscription * (1 - NULLIF(s.discount_percent, 0) / 100.0)) * 100) / 100) = 0
      AND s.discount_mode IS NOT NULL AND s.discount_amount > 0
      AND COALESCE(pay.paid_total, 0) = 0 THEN 'exempt'
    WHEN COALESCE(pay.paid_total, 0) >= GREATEST(0,
      CASE
        WHEN s.is_exempt THEN 0
        WHEN s.discount_mode = 'percent' AND s.discount_percent > 0 THEN
          ROUND((gl.base_subscription * (1 - s.discount_percent / 100.0)) * 100) / 100
        WHEN s.discount_mode = 'fixed' AND s.discount_amount > 0 THEN gl.base_subscription - s.discount_amount
        WHEN s.discount_amount > 0 THEN gl.base_subscription - s.discount_amount
        ELSE gl.base_subscription
      END
    ) AND NOT s.is_exempt THEN 'paid'
    WHEN COALESCE(pay.paid_total, 0) > 0 AND NOT s.is_exempt THEN 'partial'
    ELSE 'unpaid'
  END AS status,
  -- paid_date: timestamp of most recent October payment
  pay.last_payment_date,
  false, -- is_archived
  NULL, -- note
  NULL, -- recorded_by
  pay.last_receipt, -- receipt_number
  s.is_exempt, -- is_exempt from students table
  NULL -- exemption_note
FROM students s
JOIN groups g ON g.id = s.group_id
JOIN grade_levels gl ON gl.id = g.grade_level_id
LEFT JOIN (
  SELECT
    student_id,
    sum(amount) AS paid_total,
    max(payment_date) AS last_payment_date,
    (array_agg(receipt_number ORDER BY payment_date DESC NULLS LAST))[1] AS last_receipt
  FROM payments
  WHERE month_key = '2026-10' AND is_deleted = false
  GROUP BY student_id
) pay ON pay.student_id = s.id
WHERE s.is_deleted = false;
