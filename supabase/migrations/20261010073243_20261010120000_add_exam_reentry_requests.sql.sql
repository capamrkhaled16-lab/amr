/*
# Exam Re-entry Request System

1. New Table
- `exam_reentry_requests` — stores student requests to re-enter an exam they already started or submitted.
  - `id` (uuid PK)
  - `exam_id` (uuid FK → exams.id) — which exam the request is for
  - `submission_id` (uuid, nullable FK → exam_submissions.id) — the existing attempt
  - `student_id` (uuid, nullable) — the student's internal ID (null for open/external exams)
  - `student_name` (text) — student's display name
  - `student_phone` (text, nullable) — phone or identifier
  - `status` (text) — 'pending' | 'approved' | 'rejected' (default 'pending')
  - `reason` (text, nullable) — student-provided reason
  - `resolved_by` (text, nullable) — admin who approved/rejected
  - `resolved_at` (timestamptz, nullable) — when the request was resolved
  - `created_at` (timestamptz, default now())

2. Security
- RLS enabled on `exam_reentry_requests`.
- Anon + authenticated can INSERT (students submit requests from the public exam portal).
- Anon + authenticated can SELECT (the portal needs to check if a request exists; admin dashboard reads them).
- Anon + authenticated can UPDATE (admin approves/rejects from the dashboard which uses anon key).
  - In production, approval should go through a SECURITY DEFINER function or edge function,
    but the current platform architecture uses anon-key for all operations, matching existing exam_submissions policies.
- Unique constraint on (exam_id, student_phone, student_id) for status='pending' to prevent duplicate pending requests.

3. Notes
- This table does NOT modify any existing tables, columns, or data.
- Existing exam submissions, results, and attempts are fully preserved.
- The unique index prevents duplicate pending requests from the same student for the same exam.
*/

CREATE TABLE IF NOT EXISTS exam_reentry_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES exam_submissions(id) ON DELETE SET NULL,
  student_id uuid,
  student_name text NOT NULL,
  student_phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE exam_reentry_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reentry_requests" ON exam_reentry_requests;
CREATE POLICY "anon_select_reentry_requests" ON exam_reentry_requests
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_reentry_requests" ON exam_reentry_requests;
CREATE POLICY "anon_insert_reentry_requests" ON exam_reentry_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_reentry_requests" ON exam_reentry_requests;
CREATE POLICY "anon_update_reentry_requests" ON exam_reentry_requests
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_reentry_requests" ON exam_reentry_requests;
CREATE POLICY "anon_delete_reentry_requests" ON exam_reentry_requests
  FOR DELETE TO anon, authenticated USING (true);

-- Prevent duplicate pending requests: one pending request per student per exam
CREATE UNIQUE INDEX IF NOT EXISTS idx_reentry_pending_unique
  ON exam_reentry_requests (exam_id, COALESCE(student_phone, ''), COALESCE(student_id, '00000000-0000-0000-0000-000000000000'))
  WHERE status = 'pending';

-- Enable realtime for admin dashboard
ALTER TABLE exam_reentry_requests REPLICA IDENTITY FULL;
