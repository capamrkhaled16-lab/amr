/*
# Create archive_issue_ignores table

1. New Tables
- `archive_issue_ignores`
  - `id` (uuid, primary key)
  - `issue_key` (text, not null) — stable key: type|record_id|student_id|exam_id|group_id
  - `issue_type` (text, not null) — one of the PreArchiveIssue type values
  - `student_id` (text, nullable)
  - `group_id` (text, nullable)
  - `month_key` (text, not null) — the archive month this issue belongs to
  - `reason` (text, not null) — user-supplied reason for skipping
  - `status` (text, not null default 'skipped_by_user') — skipped_by_user | restored
  - `created_at` (timestamptz, default now())
  - `restored_at` (timestamptz, nullable)

2. Security
- Enable RLS on `archive_issue_ignores`.
- Grant CRUD to `anon` + `authenticated` (no-auth app, anon-key frontend).
- Allow anon + authenticated full CRUD because the data is intentionally shared/public.

3. Notes
- Unique index on (issue_key, month_key) where status = 'skipped_by_user' prevents duplicate skip records for the same issue in the same month.
- Restoring an issue sets status = 'restored' and restored_at, allowing the issue to reappear in the active repair queue.
*/

CREATE TABLE IF NOT EXISTS archive_issue_ignores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_key text NOT NULL,
  issue_type text NOT NULL,
  student_id text,
  group_id text,
  month_key text NOT NULL,
  reason text NOT NULL DEFAULT 'تم التجاوز بقرار المستخدم',
  status text NOT NULL DEFAULT 'skipped_by_user',
  created_at timestamptz DEFAULT now(),
  restored_at timestamptz
);

ALTER TABLE archive_issue_ignores ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON archive_issue_ignores TO anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS archive_issue_ignores_active_unique
  ON archive_issue_ignores (issue_key, month_key)
  WHERE status = 'skipped_by_user';

CREATE INDEX IF NOT EXISTS archive_issue_ignores_month_idx
  ON archive_issue_ignores (month_key)
  WHERE status = 'skipped_by_user';
