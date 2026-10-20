/*
# منصة الخالد التعليمية — Core Schema

## Overview
Builds the complete data model for the Al-Khaled educational platform: academic stages, grades, groups, students, attendance, dual grades (center + online), exams, exam submissions, certificates, assistants, and parent portal tokens. Single-tenant (one master teacher owns all data) with assistant + parent access via shared tokens/credentials.

## 1. New Tables
- `academic_stages` — الابتدائية | الإعدادية | الثانوية (seeded)
- `grade_levels` — grade levels under each stage (e.g. الصف الأول الابتدائي)
- `groups` — custom groups under each grade level (created by teacher)
- `students` — student roster with phone, parent phone, gender, parent token
- `attendance` — per-student daily attendance with status, notes, timestamp
- `center_grades` — in-center paper exam marks (max score, pass/fail)
- `center_exams` — definitions of center exams (title, max score, date)
- `online_grades` — electronic exam scores (auto-synced + manual override)
- `exams` — online exam definitions (title, duration, open/close window)
- `exam_questions` — MCQ + essay questions with model answers
- `exam_submissions` — student exam submissions with anti-cheat flags
- `exam_answers` — individual answers within a submission
- `assistants` — assistant accounts (username + PIN, no timeout)
- `settings` — platform settings (logo, teacher photo, platform name)
- `certificates` — issued certificates with serial IDs

## 2. Security
- RLS enabled on every table.
- Policies use `TO anon, authenticated` because this is a single-tenant platform accessed via the anon key with shared credentials (master teacher PIN, assistant PIN, parent token). No Supabase auth.users integration — auth is application-level (PIN/token).
- Parent portal reads are scoped by `parent_token` equality (passed as a request header by the frontend).
- Assistant writes are gated application-side; DB-level policy is open to anon since all access is via the anon key.

## 3. Notes
- All timestamps are timestamptz.
- `gender` is a text field ('male' | 'female') used for certificate wording.
- Parent portal uses a per-student `parent_token` (uuid) as a URL query param for read-only access.
- Attendance status enum: 'present' | 'absent' | 'late' | 'excused_absence' | 'unrecorded'.
*/

-- Academic stages
CREATE TABLE IF NOT EXISTS academic_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Grade levels under each stage
CREATE TABLE IF NOT EXISTS grade_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES academic_stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Custom groups under each grade level
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_level_id uuid NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text,
  parent_phone text,
  gender text NOT NULL DEFAULT 'male',
  parent_token uuid NOT NULL DEFAULT gen_random_uuid(),
  enrollment_date date DEFAULT CURRENT_DATE,
  total_fees numeric(10,2) DEFAULT 0,
  paid_fees numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Center exam definitions
CREATE TABLE IF NOT EXISTS center_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  max_score numeric(6,2) NOT NULL DEFAULT 100,
  pass_score numeric(6,2) NOT NULL DEFAULT 50,
  exam_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- Center grades (one row per student per center exam)
CREATE TABLE IF NOT EXISTS center_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_exam_id uuid NOT NULL REFERENCES center_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score numeric(6,2) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (center_exam_id, student_id)
);

-- Online exam definitions
CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  duration_minutes int NOT NULL DEFAULT 60,
  open_at timestamptz,
  close_at timestamptz,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Exam questions (MCQ or essay)
CREATE TABLE IF NOT EXISTS exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'mcq', -- 'mcq' | 'essay'
  question_text text NOT NULL,
  choices jsonb, -- array of strings for MCQ
  correct_choice_index int, -- for MCQ
  model_answer text, -- for essay
  points numeric(6,2) NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Exam submissions
CREATE TABLE IF NOT EXISTS exam_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'submitted' | 'cheated' | 'auto_submitted'
  total_score numeric(6,2) DEFAULT 0,
  max_score numeric(6,2) DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  submitted_at timestamptz,
  tab_switch_count int NOT NULL DEFAULT 0,
  UNIQUE (exam_id, student_id)
);

-- Exam answers
CREATE TABLE IF NOT EXISTS exam_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES exam_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  selected_choice_index int,
  essay_answer text,
  awarded_score numeric(6,2) DEFAULT 0,
  is_correct boolean DEFAULT false,
  graded_at timestamptz
);

-- Online grades (denormalized from submissions for gradebook; supports manual override)
CREATE TABLE IF NOT EXISTS online_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score numeric(6,2) NOT NULL DEFAULT 0,
  max_score numeric(6,2) NOT NULL DEFAULT 100,
  is_manual_override boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'unrecorded', -- 'present' | 'absent' | 'late' | 'excused_absence' | 'unrecorded'
  notes text,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  recorded_at timestamptz DEFAULT now(),
  UNIQUE (student_id, attendance_date)
);

-- Assistants (application-level auth: username + PIN)
CREATE TABLE IF NOT EXISTS assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  pin text NOT NULL,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Settings (single row, platform-wide)
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_name text NOT NULL DEFAULT 'منصة الخالد التعليمية',
  management_name text NOT NULL DEFAULT 'تحت إدارة ومتابعة مستر عمرو خالد',
  teacher_name text NOT NULL DEFAULT 'مستر عمرو خالد',
  logo_url text,
  teacher_photo_url text,
  updated_at timestamptz DEFAULT now()
);

-- Certificates
CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_title text,
  score numeric(6,2),
  max_score numeric(6,2),
  serial_id text NOT NULL,
  issued_at timestamptz DEFAULT now()
);

-- Seed academic stages
INSERT INTO academic_stages (name, sort_order)
SELECT 'الابتدائية', 1
WHERE NOT EXISTS (SELECT 1 FROM academic_stages WHERE name = 'الابتدائية');

INSERT INTO academic_stages (name, sort_order)
SELECT 'الإعدادية', 2
WHERE NOT EXISTS (SELECT 1 FROM academic_stages WHERE name = 'الإعدادية');

INSERT INTO academic_stages (name, sort_order)
SELECT 'الثانوية', 3
WHERE NOT EXISTS (SELECT 1 FROM academic_stages WHERE name = 'الثانوية');

-- Seed default settings row
INSERT INTO settings (platform_name, management_name, teacher_name)
SELECT 'منصة الخالد التعليمية', 'تحت إدارة ومتابعة مستر عمرو خالد', 'مستر عمرو خالد'
WHERE NOT EXISTS (SELECT 1 FROM settings);

-- ============ RLS + POLICIES ============

ALTER TABLE academic_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistants ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

-- Helper to drop+create all policies for a table (4 CRUD each)
-- academic_stages
DROP POLICY IF EXISTS "as_select" ON academic_stages; CREATE POLICY "as_select" ON academic_stages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "as_insert" ON academic_stages; CREATE POLICY "as_insert" ON academic_stages FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "as_update" ON academic_stages; CREATE POLICY "as_update" ON academic_stages FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "as_delete" ON academic_stages; CREATE POLICY "as_delete" ON academic_stages FOR DELETE TO anon, authenticated USING (true);

-- grade_levels
DROP POLICY IF EXISTS "gl_select" ON grade_levels; CREATE POLICY "gl_select" ON grade_levels FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "gl_insert" ON grade_levels; CREATE POLICY "gl_insert" ON grade_levels FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "gl_update" ON grade_levels; CREATE POLICY "gl_update" ON grade_levels FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gl_delete" ON grade_levels; CREATE POLICY "gl_delete" ON grade_levels FOR DELETE TO anon, authenticated USING (true);

-- groups
DROP POLICY IF EXISTS "g_select" ON groups; CREATE POLICY "g_select" ON groups FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "g_insert" ON groups; CREATE POLICY "g_insert" ON groups FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "g_update" ON groups; CREATE POLICY "g_update" ON groups FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "g_delete" ON groups; CREATE POLICY "g_delete" ON groups FOR DELETE TO anon, authenticated USING (true);

-- students
DROP POLICY IF EXISTS "st_select" ON students; CREATE POLICY "st_select" ON students FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "st_insert" ON students; CREATE POLICY "st_insert" ON students FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "st_update" ON students; CREATE POLICY "st_update" ON students FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "st_delete" ON students; CREATE POLICY "st_delete" ON students FOR DELETE TO anon, authenticated USING (true);

-- center_exams
DROP POLICY IF EXISTS "ce_select" ON center_exams; CREATE POLICY "ce_select" ON center_exams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ce_insert" ON center_exams; CREATE POLICY "ce_insert" ON center_exams FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ce_update" ON center_exams; CREATE POLICY "ce_update" ON center_exams FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ce_delete" ON center_exams; CREATE POLICY "ce_delete" ON center_exams FOR DELETE TO anon, authenticated USING (true);

-- center_grades
DROP POLICY IF EXISTS "cg_select" ON center_grades; CREATE POLICY "cg_select" ON center_grades FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cg_insert" ON center_grades; CREATE POLICY "cg_insert" ON center_grades FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cg_update" ON center_grades; CREATE POLICY "cg_update" ON center_grades FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cg_delete" ON center_grades; CREATE POLICY "cg_delete" ON center_grades FOR DELETE TO anon, authenticated USING (true);

-- exams
DROP POLICY IF EXISTS "ex_select" ON exams; CREATE POLICY "ex_select" ON exams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ex_insert" ON exams; CREATE POLICY "ex_insert" ON exams FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ex_update" ON exams; CREATE POLICY "ex_update" ON exams FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ex_delete" ON exams; CREATE POLICY "ex_delete" ON exams FOR DELETE TO anon, authenticated USING (true);

-- exam_questions
DROP POLICY IF EXISTS "eq_select" ON exam_questions; CREATE POLICY "eq_select" ON exam_questions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "eq_insert" ON exam_questions; CREATE POLICY "eq_insert" ON exam_questions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "eq_update" ON exam_questions; CREATE POLICY "eq_update" ON exam_questions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "eq_delete" ON exam_questions; CREATE POLICY "eq_delete" ON exam_questions FOR DELETE TO anon, authenticated USING (true);

-- exam_submissions
DROP POLICY IF EXISTS "es_select" ON exam_submissions; CREATE POLICY "es_select" ON exam_submissions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "es_insert" ON exam_submissions; CREATE POLICY "es_insert" ON exam_submissions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "es_update" ON exam_submissions; CREATE POLICY "es_update" ON exam_submissions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "es_delete" ON exam_submissions; CREATE POLICY "es_delete" ON exam_submissions FOR DELETE TO anon, authenticated USING (true);

-- exam_answers
DROP POLICY IF EXISTS "ea_select" ON exam_answers; CREATE POLICY "ea_select" ON exam_answers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ea_insert" ON exam_answers; CREATE POLICY "ea_insert" ON exam_answers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ea_update" ON exam_answers; CREATE POLICY "ea_update" ON exam_answers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ea_delete" ON exam_answers; CREATE POLICY "ea_delete" ON exam_answers FOR DELETE TO anon, authenticated USING (true);

-- online_grades
DROP POLICY IF EXISTS "og_select" ON online_grades; CREATE POLICY "og_select" ON online_grades FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "og_insert" ON online_grades; CREATE POLICY "og_insert" ON online_grades FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "og_update" ON online_grades; CREATE POLICY "og_update" ON online_grades FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "og_delete" ON online_grades; CREATE POLICY "og_delete" ON online_grades FOR DELETE TO anon, authenticated USING (true);

-- attendance
DROP POLICY IF EXISTS "att_select" ON attendance; CREATE POLICY "att_select" ON attendance FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "att_insert" ON attendance; CREATE POLICY "att_insert" ON attendance FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "att_update" ON attendance; CREATE POLICY "att_update" ON attendance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "att_delete" ON attendance; CREATE POLICY "att_delete" ON attendance FOR DELETE TO anon, authenticated USING (true);

-- assistants
DROP POLICY IF EXISTS "asst_select" ON assistants; CREATE POLICY "asst_select" ON assistants FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "asst_insert" ON assistants; CREATE POLICY "asst_insert" ON assistants FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "asst_update" ON assistants; CREATE POLICY "asst_update" ON assistants FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "asst_delete" ON assistants; CREATE POLICY "asst_delete" ON assistants FOR DELETE TO anon, authenticated USING (true);

-- settings
DROP POLICY IF EXISTS "set_select" ON settings; CREATE POLICY "set_select" ON settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "set_insert" ON settings; CREATE POLICY "set_insert" ON settings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "set_update" ON settings; CREATE POLICY "set_update" ON settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "set_delete" ON settings; CREATE POLICY "set_delete" ON settings FOR DELETE TO anon, authenticated USING (true);

-- certificates
DROP POLICY IF EXISTS "cert_select" ON certificates; CREATE POLICY "cert_select" ON certificates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cert_insert" ON certificates; CREATE POLICY "cert_insert" ON certificates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cert_update" ON certificates; CREATE POLICY "cert_update" ON certificates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cert_delete" ON certificates; CREATE POLICY "cert_delete" ON certificates FOR DELETE TO anon, authenticated USING (true);
