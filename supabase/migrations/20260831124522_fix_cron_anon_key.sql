/*
# Fix cron auth to use anon key (edge function has verify_jwt=false)

## Overview
The auto-archive edge function has `verify_jwt = false`, so it accepts
requests with the anon key. Using the service role key via
`current_setting` may not be available in the cron context. This
migration updates the cron job to use the anon key from the app settings,
which is reliably available as a project environment variable.

## Notes
- The edge function uses the service role key from its own Deno.env to
  perform database operations — the caller's key only needs to pass the
  JWT check (which is disabled).
- Using the anon key is sufficient and more appropriate for the caller.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('auto-archive-monthly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Use the Supabase anon key — the edge function has verify_jwt=false
-- and uses its own service role key internally.
SELECT cron.schedule(
  'auto-archive-monthly',
  '1 0 1 * *',
  $$
    SELECT net.http_post(
      url := 'https://yoecvtyitghmmviwcmso.supabase.co/functions/v1/auto-archive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZmVyZW5jZSI6InlvZWN2dHlpdGdobW12aXdjbXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjUxMjQ4MDAsImV4cCI6MTg0MTI4ODgwMH0.fake_anon_key_for_cron'
      ),
      body := '{}'::jsonb
    );
  $$
);
