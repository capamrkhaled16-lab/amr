/*
# Fix cron auth with correct anon key

## Overview
Replace the placeholder anon key with the actual project anon key.
The auto-archive edge function has verify_jwt=false, so the anon key
is sufficient for the cron-triggered HTTP call.

## Notes
- The edge function uses its own SUPABASE_SERVICE_ROLE_KEY internally.
- Idempotent: unschedules before re-scheduling.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('auto-archive-monthly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-archive-monthly',
  '1 0 1 * *',
  $$
    SELECT net.http_post(
      url := 'https://yoecvtyitghmmviwcmso.supabase.co/functions/v1/auto-archive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvZWN2dHlpdGdobW12aXdjbXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDM5MTQsImV4cCI6MjEwMTA3OTkxNH0.7oXmulnGs2_jnZ2iYWMtekut5IDRSo1f6wqKX2tIS0M'
      ),
      body := '{}'::jsonb
    );
  $$
);
