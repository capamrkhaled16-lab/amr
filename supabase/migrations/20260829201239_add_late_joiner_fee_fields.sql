/*
# Smart Late-Joiner Financial Rule & Activity Tracking

## Overview
Adds columns to `students` that support pro-rata fee calculation for students
who join late in the month, plus a flag that marks them as "newly enrolled"
so the finances module can suppress false overdue warnings.

## Modified Table: `students`
- `fee_mode`        (text, default 'full') — 'full' | 'pro_rata' | 'deferred'
    * 'full'     : standard full-month fee (default behavior, backwards-compatible)
    * 'pro_rata' : fee calculated based on sessions attended in the join month
    * 'deferred' : current month fee deferred to next month (no debt this month)
- `pro_rata_sessions` (int, default 0) — number of sessions the student attended
  in their join month (used for pro_rata calculation)
- `join_month_key`    (text, nullable) — the month_key when the student joined
  (e.g. "2026-08"), so the system knows which month to apply pro-rata/deferred rules

## Notes
- All changes are additive ALTERs — no data is lost.
- Existing rows get 'full' as fee_mode and 0 as pro_rata_sessions, preserving
  current financial behavior exactly.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'fee_mode') THEN
    ALTER TABLE students ADD COLUMN fee_mode text NOT NULL DEFAULT 'full';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'pro_rata_sessions') THEN
    ALTER TABLE students ADD COLUMN pro_rata_sessions int NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'join_month_key') THEN
    ALTER TABLE students ADD COLUMN join_month_key text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_fee_mode ON students(fee_mode);
CREATE INDEX IF NOT EXISTS idx_students_join_month ON students(join_month_key);
CREATE INDEX IF NOT EXISTS idx_students_enrollment_date ON students(enrollment_date);
