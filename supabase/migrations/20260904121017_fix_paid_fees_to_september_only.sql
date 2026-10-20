/*
# Fix students.paid_fees to match September payments only

## Purpose
The students.paid_fees column is a cumulative field that was not
properly reset for all students when the August→September month
transition occurred. Some students still show August's paid amount
in their paid_fees, which contaminates September's financial dashboard.

## What This Does
- For every active student, recalculates paid_fees as the sum of
  their non-deleted, positive-amount payments for the current active
  month (September 2026-09) only.
- Students with no September payments get paid_fees = 0.
- This ensures the September dashboard strictly reflects only
  September payment data, completely independent of August archive
  records.

## Safety
- This is a one-time data correction.
- The total_fees column is NOT modified.
- Only active, non-deleted students are affected.
*/

UPDATE students s
SET paid_fees = COALESCE(
  (
    SELECT sum(p.amount)
    FROM payments p
    WHERE p.student_id = s.id
      AND p.month_key = '2026-09'
      AND p.is_deleted = false
      AND p.amount > 0
  ),
  0
)
WHERE s.status = 'active'
  AND s.is_deleted = false;
