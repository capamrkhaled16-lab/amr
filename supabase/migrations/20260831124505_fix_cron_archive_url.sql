/*
# Fix cron job URL for auto-archive

## Overview
The previous migration hardcoded an incorrect Supabase URL. This migration
unschedules the bad job and reschedules with the correct project URL.

## Notes
- Only the URL changes; schedule and logic remain the same.
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
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
