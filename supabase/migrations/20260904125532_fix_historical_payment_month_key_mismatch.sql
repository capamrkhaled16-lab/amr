/*
# Fix historical payment with wrong month_key

## Problem
A historical payment for August (target_archive_month='2026-08') was stored
with month_key='2026-09', causing September's queries to pick it up as a
ghost 60 EGP collected amount.

## Fix
Correct the month_key to match the target_archive_month so it no longer
contaminates September's active-month financial totals.
*/

UPDATE payments
SET month_key = target_archive_month
WHERE is_historical_payment = true
  AND target_archive_month IS NOT NULL
  AND month_key != target_archive_month;