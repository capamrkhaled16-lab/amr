/*
# Add student status column

1. Changes to `students` table:
- Add `status` column of type `text`, NOT NULL, default 'active'.
- Allowed values: 'active', 'left', 'deleted'.
- Backfill: rows where `is_deleted = true` get `status = 'deleted'`.
- Backfill: rows where `is_deleted = false` get `status = 'active'`.
- Add CHECK constraint to enforce valid status values.
- Add index on `status` for faster filtering.

2. Notes:
- The existing `is_deleted` column is kept for backwards compatibility but
  the application will now use `status` as the single source of truth.
- All dashboard counters and student lists will query `status = 'active'`.
- "Mark as Left" sets `status = 'left'`; "Delete" sets `status = 'deleted'`.
- This does NOT drop or modify any existing data — it only adds a column.
*/

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Backfill from is_deleted
UPDATE students SET status = 'deleted' WHERE is_deleted = true AND status = 'active';
UPDATE students SET status = 'active' WHERE is_deleted = false AND status = 'active';

-- Add CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_status_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_status_check
      CHECK (status IN ('active', 'left', 'deleted'));
  END IF;
END $$;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_students_status ON students (status);
