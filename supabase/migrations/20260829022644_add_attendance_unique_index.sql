/*
# Add unique index on attendance to prevent duplicate records per student per date

1. Changes
- Add unique index on attendance(student_id, attendance_date) to prevent duplicate attendance records
- This fixes the "9 sessions instead of 8" issue where makeup sessions or cross-group attendance creates duplicate entries
2. Notes
- Uses IF NOT EXISTS for idempotency
- Existing duplicates (if any) are not automatically removed — they would need manual cleanup
- The unique constraint ensures going forward no student can have two attendance records for the same date
*/

CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_date_unique
  ON attendance (student_id, attendance_date);
