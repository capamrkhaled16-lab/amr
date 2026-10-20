/*
# Purge ghost paid_fees values for September

## Problem
After the August→September month transition, 12+ active students retained
stale `paid_fees` values (90–110 EGP) from August, even though they had ZERO
September payments. This caused the dashboard to display "ghost" collected
amounts that didn't belong to September.

## Fix
Reset `paid_fees` to 0 for ALL active students whose `paid_fees > 0` but who
have no actual September (2026-09) payment records. This ensures September's
financial counters start at absolute zero unless a real September payment exists.

## Safety
- Only touches students with status='active' (not deleted/left students)
- Only zeroes out students with NO matching September payment
- Students WITH September payments keep their paid_fees (which is already
  recalculated from the payments table by createPayment/deletePaymentWithAudit)
- Exempt students already have paid_fees=0 from setStudentExemption
- This is idempotent: re-running it produces no further changes
*/

UPDATE students s
SET paid_fees = 0
WHERE s.status = 'active'
  AND s.paid_fees > 0
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.student_id = s.id
      AND p.month_key = '2026-09'
      AND p.is_deleted = false
      AND p.amount > 0
  );