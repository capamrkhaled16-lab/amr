/*
# Add behavior tracking scope and homework session binding

## Changes

1. behavior_eval table: add `scope` column (text, default 'daily')
   - Allows teachers to switch between daily/session-based, weekly, or monthly behavior tracking
   - Values: 'daily', 'weekly', 'monthly'
   
2. homework table: add `session_id` column (uuid, nullable, references sessions)
   - Allows binding homework to a specific session instead of just the group
   - Nullable so existing group-level homework still works

## Security
- No RLS changes needed — existing policies on these tables already cover the new columns
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'behavior_eval' AND column_name = 'scope') THEN
    ALTER TABLE behavior_eval ADD COLUMN scope text NOT NULL DEFAULT 'daily';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'homework' AND column_name = 'session_id') THEN
    ALTER TABLE homework ADD COLUMN session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;
  END IF;
END $$;
