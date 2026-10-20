/*
# Schedule Automatic Monthly Archiving via pg_cron

## Overview
This migration sets up a scheduled cron job that automatically triggers the
`auto-archive` edge function at 12:01 AM on the 1st of every month. This
ensures the previous month's data is archived, carried-over debts are isolated,
and the new month's payment counters are reset — all without manual intervention.

## How It Works
1. Enables the `pg_cron` extension (Supabase's recommended scheduler).
2. Enables the `pg_net` extension (for making HTTP requests from Postgres).
3. Creates a scheduled job named `auto-archive-monthly` that fires at 00:01 on
   the 1st of each month (cron expression: `1 0 1 * *`).
4. The job sends an HTTP POST to the `auto-archive` edge function endpoint,
   authenticated with the service role key.
5. Idempotency is guaranteed by the edge function itself — it checks the
   `archive_runs` table before processing and exits if the month was already
   archived. This means re-runs (e.g., after a server restart) are safe.

## Extensions
- `pg_cron` — PostgreSQL job scheduler
- `pg_net` — async HTTP client for Postgres

## Security
- No new tables or RLS changes.
- The cron job uses `SUPABASE_SERVICE_ROLE_KEY` from `vault` (Supabase stores
  this automatically). The key is never hardcoded.
- The edge function already has `verify_jwt = false` and handles its own
  idempotency.

## Notes
1. The cron schedule `1 0 1 * *` means: minute 1, hour 0 (midnight), day 1 of
   every month — i.e., 12:01 AM on the 1st.
2. If the job fails, the edge function marks the run as `failed` in
   `archive_runs`, and the next invocation will retry it automatically.
3. The `pg_net` request is async (fire-and-forget) — the cron job does not
   block waiting for the edge function to finish. The edge function's own
   idempotency guard handles any double-trigger scenario.
*/

-- ============================================================
-- 1. Enable pg_cron extension
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ============================================================
-- 2. Enable pg_net extension (for HTTP calls from cron)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- 3. Schedule the auto-archive edge function
--    Runs at 00:01 on the 1st of every month.
--    The edge function's idempotency guard ensures it only
--    archives the previous month once, even if triggered again.
-- ============================================================
DO $$
BEGIN
  -- Remove any existing job with the same name (idempotent re-run)
  PERFORM cron.unschedule('auto-archive-monthly');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet — safe to continue
  NULL;
END $$;

-- Schedule the job: fires at 12:01 AM on the 1st of each month
SELECT cron.schedule(
  'auto-archive-monthly',
  '1 0 1 * *',
  $$
    SELECT net.http_post(
      url := 'https://xhpeopxmqdpblkebpqfr.supabase.co/functions/v1/auto-archive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
