/*
# Add Database Indexes for Archive Performance

## Overview
Adds indexes to the monthly_archives, archive_runs, carried_over_balances,
and payments tables to ensure fast lookups when browsing archived months
and querying historical payments. This ensures any archive can be opened
in under a second even with thousands of records.

## New Indexes
1. `monthly_archives_archive_month_idx` — index on archive_month for fast
   sorting and lookups by month.
2. `archive_runs_archive_month_idx` — index on archive_month for fast run
   history queries.
3. `carried_over_balances_student_idx` — index on student_id for fast
   per-student carried-over balance lookups.
4. `carried_over_balances_to_month_idx` — index on to_month for fast
   "what's carried into this month" queries.
5. `carried_over_balances_settled_idx` — partial index on is_settled for
   fast "unsettled balances" queries.
6. `payments_historical_idx` — partial index on is_historical_payment for
   fast historical payment queries.
7. `payments_student_month_idx` — composite index on student_id + month_key
   for fast per-student-per-month payment lookups.

## Security
- No RLS or schema changes — indexes only.
*/

CREATE INDEX IF NOT EXISTS monthly_archives_archive_month_idx
  ON monthly_archives (archive_month);

CREATE INDEX IF NOT EXISTS archive_runs_archive_month_idx
  ON archive_runs (archive_month);

CREATE INDEX IF NOT EXISTS carried_over_balances_student_idx
  ON carried_over_balances (student_id);

CREATE INDEX IF NOT EXISTS carried_over_balances_to_month_idx
  ON carried_over_balances (to_month);

CREATE INDEX IF NOT EXISTS carried_over_balances_settled_idx
  ON carried_over_balances (is_settled)
  WHERE is_settled = false;

CREATE INDEX IF NOT EXISTS payments_historical_idx
  ON payments (is_historical_payment)
  WHERE is_historical_payment = true;

CREATE INDEX IF NOT EXISTS payments_student_month_idx
  ON payments (student_id, month_key);
