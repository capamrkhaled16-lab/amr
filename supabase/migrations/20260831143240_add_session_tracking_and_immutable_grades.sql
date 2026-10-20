/*
# Add session tracking, immutable grades, and rank breakdown support

## Changes
1. attendance.session_id — links attendance records to specific sessions
2. center_exams.session_id — links exams (especially recitation) to sessions
3. center_grades.is_locked — prevents modification after grade is finalized
4. center_grades.locked_at — timestamp of when grade was locked
5. center_grades.locked_by — who locked the grade
6. Indexes for session-based lookups
*/

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE center_exams ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE center_grades ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE center_grades ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE center_grades ADD COLUMN IF NOT EXISTS locked_by text;

CREATE INDEX IF NOT EXISTS attendance_session_idx ON attendance (session_id);
CREATE INDEX IF NOT EXISTS attendance_student_session_idx ON attendance (student_id, session_id);
CREATE INDEX IF NOT EXISTS center_exams_session_idx ON center_exams (session_id);
CREATE INDEX IF NOT EXISTS center_grades_locked_idx ON center_grades (is_locked) WHERE is_locked = true;
