/*
# Add exemption + flexible discount engine to students

## Overview
1. Adds `is_exempt` (boolean, default false) — marks a student as fully exempt
   from payment. When true, the student's total_fees is treated as 0 and they
   are excluded from unpaid/overdue calculations.
2. Adds `discount_mode` (text, nullable) — 'fixed' or 'percent' for flexible
   partial discounts. NULL means no flexible discount.
3. Adds `discount_percent` (numeric, default 0) — percentage discount (0-100)
   used when discount_mode = 'percent'.
   (discount_amount already exists for fixed-amount discounts.)

## Security
- No new tables. Existing student CRUD policies cover the new columns.
*/

ALTER TABLE students ADD COLUMN IF NOT EXISTS is_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS discount_mode text;
ALTER TABLE students ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0;

-- Backfill: any student with discount_amount > 0 gets discount_mode = 'fixed'
UPDATE students SET discount_mode = 'fixed' WHERE discount_amount > 0 AND discount_mode IS NULL;
