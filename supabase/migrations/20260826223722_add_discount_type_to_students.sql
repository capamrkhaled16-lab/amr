/*
# Add discount type and discount amount to students

1. New Columns
- `students.discount_type` (text, nullable) — values: 'sibling', 'grant', 'special', or NULL for no discount
- `students.discount_amount` (numeric, default 0) — fixed discount amount in EGP applied to subscription fees

2. Purpose
- Allows the center to tag each student with a discount category (sibling discount, scholarship/grant, or special discount)
- The discount amount is subtracted from the base subscription fee automatically when generating monthly subscriptions
- This enables dynamic, automatic discount calculation at payment time

3. Security
- No new tables; existing RLS policies on `students` remain unchanged
- No changes to policies needed — the new columns are covered by existing student CRUD policies
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'discount_type'
  ) THEN
    ALTER TABLE students ADD COLUMN discount_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'students' AND column_name = 'discount_amount'
  ) THEN
    ALTER TABLE students ADD COLUMN discount_amount numeric DEFAULT 0;
  END IF;
END $$;
