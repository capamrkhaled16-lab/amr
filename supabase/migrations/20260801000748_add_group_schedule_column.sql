/*
# Add schedule column to groups

## Overview
Adds an optional `schedule` text column to the `groups` table so the financial
unpaid-students modal can show each group's schedule/time (الموعد).

## Safety
- Nullable, defaults to NULL. Existing rows are unaffected.
- No data is lost; the column is purely additive.
*/

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS schedule text;
