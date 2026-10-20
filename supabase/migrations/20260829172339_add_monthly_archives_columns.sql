/*
# Smart Archive System — add status/lock columns to monthly_archives

## Overview
The `monthly_archives` table already exists (created earlier by the auto-archive
edge function) with columns: id, archive_month, archive_data, archived_at,
created_at. This migration adds the columns needed by the Smart Archive UI:

## Modified Table: `monthly_archives`
- `status`        (text, default 'open') — 'open' | 'archived' | 'pending'
- `is_locked`     (boolean, default false) — master-PIN override gate
- `record_counts` (jsonb, default '{}') — quick summary of row counts per table
- `updated_at`    (timestamptz, default now()) — last modification time

## Security
- No new policies needed; existing CRUD policies on monthly_archives remain.

## Notes
- All changes are additive ALTERs — no data is lost.
- Existing rows get sensible defaults: status='open', is_locked=false.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monthly_archives' AND column_name = 'status') THEN
    ALTER TABLE monthly_archives ADD COLUMN status text NOT NULL DEFAULT 'open';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monthly_archives' AND column_name = 'is_locked') THEN
    ALTER TABLE monthly_archives ADD COLUMN is_locked boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monthly_archives' AND column_name = 'record_counts') THEN
    ALTER TABLE monthly_archives ADD COLUMN record_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monthly_archives' AND column_name = 'updated_at') THEN
    ALTER TABLE monthly_archives ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_monthly_archives_month ON monthly_archives(archive_month);
CREATE INDEX IF NOT EXISTS idx_monthly_archives_status ON monthly_archives(status);

CREATE OR REPLACE FUNCTION update_updated_at_monthly_archives()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_monthly_archives_updated ON monthly_archives;
CREATE TRIGGER trg_monthly_archives_updated
  BEFORE UPDATE ON monthly_archives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_monthly_archives();
