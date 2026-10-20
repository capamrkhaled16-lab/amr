/*
# Fix doubled paid_fees and auto-recalculate from actual payments

## Problem
students.paid_fees is a denormalized field that drifts from the actual
payment sum. When a historical payment is added for a past month, the
paid_fees field can end up doubled (e.g. 180 instead of 90) because
the recalculation in createPayment() only runs for the current payment's
month and doesn't account for historical payments correctly.

## Fix
1. Create a SECURITY DEFINER function that recalculates paid_fees from
   the SUM of all active (non-deleted, non-historical) payments across
   ALL months for a given student.
2. Create a trigger on the payments table that auto-recalculates
   paid_fees whenever a payment is inserted, updated, or deleted.
3. Run a one-time fix to correct all existing wrong values.
4. Also sync monthly_subscriptions.amount_paid to match the per-month
   payment sum.

## Security
- SECURITY DEFINER function with fixed search_path
- No new tables, no RLS changes, no data loss
*/

-- Function to recalculate a student's paid_fees from actual payments
CREATE OR REPLACE FUNCTION public.recalc_student_paid_fees(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actual_total numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
  INTO actual_total
  FROM payments
  WHERE student_id = p_student_id
    AND is_deleted = false
    AND is_historical_payment = false
    AND amount > 0;

  UPDATE students
  SET paid_fees = actual_total
  WHERE id = p_student_id;
END;
$function$;

-- Function to recalculate monthly_subscriptions.amount_paid for a given student+month
CREATE OR REPLACE FUNCTION public.recalc_subscription_paid(p_student_id uuid, p_month_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  month_total numeric;
  sub_id uuid;
  sub_due numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
  INTO month_total
  FROM payments
  WHERE student_id = p_student_id
    AND month_key = p_month_key
    AND is_deleted = false
    AND amount > 0;

  SELECT id, amount_due
  INTO sub_id, sub_due
  FROM monthly_subscriptions
  WHERE student_id = p_student_id AND month_key = p_month_key
  ORDER BY created_at DESC
  LIMIT 1;

  IF sub_id IS NOT NULL THEN
    UPDATE monthly_subscriptions
    SET amount_paid = LEAST(sub_due, month_total),
        status = CASE
          WHEN month_total <= 0 THEN 'unpaid'
          WHEN month_total >= sub_due THEN 'paid'
          ELSE 'partial'
        END,
        paid_date = CASE WHEN month_total >= sub_due THEN COALESCE(paid_date, now()) ELSE NULL END
    WHERE id = sub_id;
  END IF;
END;
$function$;

-- Trigger function that fires on payment INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.trigger_recalc_paid_fees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sid uuid;
  mk text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    sid := OLD.student_id;
    mk := OLD.month_key;
  ELSE
    sid := NEW.student_id;
    mk := NEW.month_key;
  END IF;

  -- Recalculate the student's total paid_fees
  PERFORM public.recalc_student_paid_fees(sid);

  -- Recalculate the monthly subscription for the affected month
  IF mk IS NOT NULL THEN
    PERFORM public.recalc_subscription_paid(sid, mk);
  END IF;

  -- If UPDATE changed month_key, also recalc the old month's subscription
  IF (TG_OP = 'UPDATE' AND OLD.month_key IS NOT NULL AND OLD.month_key IS DISTINCT FROM NEW.month_key) THEN
    PERFORM public.recalc_subscription_paid(OLD.student_id, OLD.month_key);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Create the trigger on payments
DROP TRIGGER IF EXISTS payments_paid_fees_recalc ON payments;
CREATE TRIGGER payments_paid_fees_recalc
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_recalc_paid_fees();

-- One-time fix: recalculate ALL students' paid_fees from actual payments
UPDATE students s
SET paid_fees = COALESCE((
  SELECT SUM(p.amount) FROM payments p
  WHERE p.student_id = s.id
    AND p.is_deleted = false
    AND p.is_historical_payment = false
    AND p.amount > 0
), 0)
WHERE s.is_deleted = false;

-- One-time fix: sync monthly_subscriptions.amount_paid for all active months
UPDATE monthly_subscriptions ms
SET amount_paid = LEAST(ms.amount_due, COALESCE((
  SELECT SUM(p.amount) FROM payments p
  WHERE p.student_id = ms.student_id
    AND p.month_key = ms.month_key
    AND p.is_deleted = false
    AND p.amount > 0
), 0)),
status = CASE
  WHEN COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.student_id = ms.student_id
      AND p.month_key = ms.month_key
      AND p.is_deleted = false
      AND p.amount > 0
  ), 0) <= 0 THEN 'unpaid'
  WHEN COALESCE((
    SELECT SUM(p.amount) FROM payments p
    WHERE p.student_id = ms.student_id
      AND p.month_key = ms.month_key
      AND p.is_deleted = false
      AND p.amount > 0
  ), 0) >= ms.amount_due THEN 'paid'
  ELSE 'partial'
END
WHERE ms.is_archived = false;
