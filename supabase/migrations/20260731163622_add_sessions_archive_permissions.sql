/*
# Sessions, monthly archive, and expanded assistant permissions

## Overview
1. Creates a `sessions` table for tracking individual class sessions (حصة) per group per month.
2. Creates a `monthly_archive` table for storing archived month data (sessions, exams, student snapshots).
3. Expands assistant permissions with more granular toggles matching the reference design.

## 1. New Tables

### `sessions`
- `id` (uuid PK)
- `group_id` (FK to groups, cascade delete)
- `title` (text — e.g. "حصة 1")
- `month` (text — e.g. "يوليو 2026")
- `is_archived` (boolean, default false)
- `created_at` (timestamptz)

### `monthly_archive`
- `id` (uuid PK)
- `group_id` (FK to groups, cascade delete)
- `month` (text — e.g. "يوليو 2026")
- `archive_data` (jsonb — snapshot of sessions, exams, student data)
- `created_at` (timestamptz)

## 2. Modified Tables

### `assistants` — new permission columns
- `can_manage_subscriptions` (boolean, default false)
- `can_view_results_only` (boolean, default false)
- `can_edit_questions` (boolean, default false)
- `can_live_monitor` (boolean, default false)
- `can_print_reports` (boolean, default false)
- `can_grade_essay` (boolean, default false)

## 3. Security
- RLS enabled on `sessions` and `monthly_archive`.
- Policies: `TO anon, authenticated` (single-tenant platform with application-level auth).
- 4 CRUD policies per table.

## 4. Notes
- All changes are additive — no data loss.
- The `archive_data` jsonb column stores a full snapshot at archive time so historical data is preserved even if current records change.
*/

-- ============ SESSIONS TABLE ============
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  month text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sess_select" ON sessions;
CREATE POLICY "sess_select" ON sessions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sess_insert" ON sessions;
CREATE POLICY "sess_insert" ON sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sess_update" ON sessions;
CREATE POLICY "sess_update" ON sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sess_delete" ON sessions;
CREATE POLICY "sess_delete" ON sessions FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id);

-- ============ MONTHLY ARCHIVE TABLE ============
CREATE TABLE IF NOT EXISTS monthly_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  month text NOT NULL,
  archive_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE monthly_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ma_select" ON monthly_archive;
CREATE POLICY "ma_select" ON monthly_archive FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ma_insert" ON monthly_archive;
CREATE POLICY "ma_insert" ON monthly_archive FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ma_update" ON monthly_archive;
CREATE POLICY "ma_update" ON monthly_archive FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ma_delete" ON monthly_archive;
CREATE POLICY "ma_delete" ON monthly_archive FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_monthly_archive_group_id ON monthly_archive(group_id);

-- ============ EXPAND ASSISTANT PERMISSIONS ============

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_manage_subscriptions') THEN
    ALTER TABLE assistants ADD COLUMN can_manage_subscriptions boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_results_only') THEN
    ALTER TABLE assistants ADD COLUMN can_view_results_only boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_edit_questions') THEN
    ALTER TABLE assistants ADD COLUMN can_edit_questions boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_live_monitor') THEN
    ALTER TABLE assistants ADD COLUMN can_live_monitor boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_print_reports') THEN
    ALTER TABLE assistants ADD COLUMN can_print_reports boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_grade_essay') THEN
    ALTER TABLE assistants ADD COLUMN can_grade_essay boolean NOT NULL DEFAULT false;
  END IF;
END $$;
