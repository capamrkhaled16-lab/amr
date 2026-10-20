/*
# Search Performance Optimization — indexes for students table

## Overview
Adds indexes on the columns most frequently used in search queries and
group-based lookups, so results return in real-time even with many students.

## Indexes
- `idx_students_name_trgm` — trigram index on name for fast ILIKE search
- `idx_students_phone` — index on phone for fast phone search
- `idx_students_parent_phone` — index on parent_phone for fast search
- `idx_students_group_status` — composite index on (group_id, status) for
  fast group list queries (used by fetchStudentsByGroup)

## Notes
- All changes are additive CREATE INDEX — no data is lost.
- The trigram index requires the pg_trgm extension.
*/

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_students_name_trgm ON students USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone);
CREATE INDEX IF NOT EXISTS idx_students_parent_phone ON students(parent_phone);
CREATE INDEX IF NOT EXISTS idx_students_group_status ON students(group_id, status);
