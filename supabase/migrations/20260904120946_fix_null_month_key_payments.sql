/*
# Fix null month_key in payments table

## Purpose
A single payment row had month_key = NULL due to an edge case during
the month_key column rollout. This backfills it from payment_date so
all payment rows have a valid month_key, ensuring strict month-based
data isolation.

## Changes
- Updates the payments table to set month_key from to_char(payment_date, 'YYYY-MM')
  for any rows where month_key IS NULL.
- This is a one-time data fix; all future payments always set month_key
  explicitly in the application code.
*/

UPDATE payments
SET month_key = to_char(payment_date, 'YYYY-MM')
WHERE month_key IS NULL;
