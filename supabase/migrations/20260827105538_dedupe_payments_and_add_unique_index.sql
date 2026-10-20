/*
# Deduplicate payments per month and enforce uniqueness

## Overview
Cleans up duplicate payment rows per (student_id, month_key) so each student
has at most ONE active payment record per month, then adds a unique partial
index to prevent future duplicates.

## Cleanup steps
1. Hard-delete all soft-deleted payments (is_deleted = true) — they are already
   logically removed and block the unique index.
2. For each (student_id, month_key) group that still has >1 active row, keep
   the most recent one (latest created_at) and hard-delete the older duplicates.
3. Recalculate each affected student's paid_fees from the sum of their
   remaining active (non-deleted) payments, so totals stay accurate.
4. Create a unique partial index on (student_id, month_key) WHERE is_deleted = false.

## Security
- No RLS changes. payments already has open CRUD for anon, authenticated.
*/

-- Step 1: permanently remove soft-deleted payments
DELETE FROM payments WHERE is_deleted = true;

-- Step 2: remove older duplicates, keeping the latest active row per (student_id, month_key)
DELETE FROM payments
WHERE id IN (
  SELECT id FROM (
    SELECT
      p.id,
      ROW_NUMBER() OVER (
        PARTITION BY p.student_id, p.month_key
        ORDER BY p.created_at DESC
      ) AS rn
    FROM payments p
    WHERE p.month_key IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- Step 3: recalculate paid_fees for all students from actual remaining payments
UPDATE students st
SET paid_fees = COALESCE(
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
   WHERE p.student_id = st.id AND p.is_deleted = false),
  0
)
WHERE st.is_deleted = false;

-- Step 4: unique partial index — one active payment per student per month
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_student_month_unique
  ON payments (student_id, month_key)
  WHERE month_key IS NOT NULL AND is_deleted = false;
