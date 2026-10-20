/*
# Month-Scoped Exemptions and Financial Isolation

## Problem
- `students.is_exempt` is a global flag that persists across all months.
  A student exempted in September silently stays exempt in October.
- `setStudentExemption()` zeros out `total_fees` and `paid_fees`, destroying
  fee data so removing the exemption leaves the student with 0 fees.
- "حديث" status uses a 14-day window from enrollment_date instead of
  comparing join_month_key to the current month.

## Solution
1. Add `is_exempt` (boolean, default false) and `exemption_note` (text, nullable)
   to `monthly_subscriptions` so exemptions are tracked per Student + Month.
2. Backfill: for students currently globally exempt (students.is_exempt = true),
   set is_exempt = true on their current-month (2026-10) subscription.
   If no subscription row exists for 2026-10, create one.
   This does NOT create exemptions for future months.
3. The global `students.is_exempt` flag remains but is no longer the source of
   truth — `monthly_subscriptions.is_exempt` for the active month is what the
   frontend checks.
4. Add a non-unique index on (student_id, month_key) for query performance.
   A unique index cannot be created because legacy duplicate rows exist;
   the application already handles this with .limit(1) patterns.

## Tables Modified
- `monthly_subscriptions`: + `is_exempt` boolean default false, + `exemption_note` text nullable

## Security
- No RLS changes. Existing policies remain in effect.

## Important Notes
- No existing data is deleted or modified (except setting is_exempt = true on
  current-month rows for already-exempt students).
- `setStudentExemption()` will be updated in the frontend to write to
  `monthly_subscriptions` for the active month instead of zeroing `total_fees`.
*/

-- 1. Add is_exempt and exemption_note columns to monthly_subscriptions
ALTER TABLE monthly_subscriptions
  ADD COLUMN IF NOT EXISTS is_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exemption_note text;

-- 2. Backfill: for students currently globally exempt, set is_exempt = true
--    on their current-month (2026-10) subscription if one exists.
UPDATE monthly_subscriptions
SET is_exempt = true,
    exemption_note = COALESCE(exemption_note, 'موروث من الإعفاء السابق')
WHERE month_key = '2026-10'
  AND student_id IN (SELECT id FROM students WHERE is_exempt = true AND status = 'active');

-- For globally-exempt students with no 2026-10 subscription row, create one.
INSERT INTO monthly_subscriptions (student_id, month, month_key, amount_due, amount_paid, status, is_exempt, exemption_note)
SELECT
  s.id,
  'أكتوبر 2026',
  '2026-10',
  0,
  0,
  'paid',
  true,
  'موروث من الإعفاء السابق'
FROM students s
WHERE s.is_exempt = true
  AND s.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM monthly_subscriptions ms
    WHERE ms.student_id = s.id AND ms.month_key = '2026-10'
  )
ON CONFLICT DO NOTHING;

-- 3. Add non-unique index for query performance
CREATE INDEX IF NOT EXISTS idx_monthly_subs_student_month
  ON monthly_subscriptions (student_id, month_key);
