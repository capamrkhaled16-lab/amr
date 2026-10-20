-- Add missing student_id indexes for parent portal queries that filter by student_id
-- These tables previously only had PK indexes, causing full table scans on parent portal load

CREATE INDEX IF NOT EXISTS idx_certificates_student_id
  ON certificates (student_id);

CREATE INDEX IF NOT EXISTS idx_group_transfers_student_id
  ON group_transfers (student_id);

CREATE INDEX IF NOT EXISTS idx_group_transfers_student_date
  ON group_transfers (student_id, transferred_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_group_deleted
  ON sessions (group_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON payments (student_id, month_key)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_monthly_subscriptions_student_month
  ON monthly_subscriptions (student_id, month_key DESC);

CREATE INDEX IF NOT EXISTS idx_center_grades_student_exam
  ON center_grades (student_id, center_exam_id);

CREATE INDEX IF NOT EXISTS idx_online_grades_student_exam
  ON online_grades (student_id, exam_id);

CREATE INDEX IF NOT EXISTS idx_homework_status_student_recorded
  ON homework_status (student_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_behavior_eval_student_date
  ON behavior_eval (student_id, eval_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_student_date_desc
  ON attendance (student_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_students_parent_token
  ON students (parent_token);
