/*
# Add session_date column to sessions table

## Purpose
Allows teachers to create sessions with a specific date (the "active date" they are viewing),
rather than always defaulting to today's server timestamp. This enables recording past or
deferred sessions on their correct date.

## Changes
1. New column: `session_date` (date, nullable) on `sessions` table.
   - When provided, this stores the date the teacher intended for the session.
   - When NULL, the session's date is derived from `created_at` as before (backward compatible).
2. Backfill: set `session_date` = `created_at::date` for all existing rows so they have
   an explicit date immediately.
3. Index on `session_date` for efficient date-based queries.

## Security
- No RLS policy changes. Existing policies remain intact.
- No data is lost; existing rows are backfilled with their creation date.
*/

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_date date;

UPDATE sessions
  SET session_date = created_at::date
  WHERE session_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_session_date ON sessions (session_date);
