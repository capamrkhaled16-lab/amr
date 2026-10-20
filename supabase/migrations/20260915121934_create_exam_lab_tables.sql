/*
# Create Exam Lab (معمل الاختبارات) tables

## Purpose
A standalone professional exam-authoring workspace that is completely isolated
from the existing online exam platform. It supports:
- AI-powered exam generation from uploaded educational content
- Professional Gemini Notebook prompt generation
- Exam library, question bank, multiple versions, and A4 print/PDF

## New Tables

1. `exam_lab_exams` — Main exam records
   - id (uuid PK)
   - teacher_name, teacher_phone, center_name, subject
   - stage_id, grade_level_id, group_id (FKs to existing academic tables, nullable)
   - stage_name, grade_name, group_name (text snapshots for display)
   - book_name, unit_name, chapter_name, lessons (text)
   - exam_title, exam_date, duration_minutes, total_marks
   - generation_mode ('platform' | 'gemini' | 'both')
   - template ('classic' | 'modern' | 'clean' | 'center')
   - status ('draft' | 'approved' | 'archived')
   - difficulty ('easy' | 'medium' | 'hard' | 'mixed')
   - question_types (jsonb — counts per type)
   - extracted_content (text — analyzed from uploads)
   - answer_key (jsonb)
   - created_at, updated_at

2. `exam_lab_questions` — Questions for each exam
   - id (uuid PK)
   - exam_id (FK → exam_lab_exams, CASCADE)
   - question_text, question_type, marks, difficulty
   - source_lesson, choices (jsonb), correct_answer
   - image_url (text — for diagram questions)
   - sort_order (int)
   - is_approved (boolean)
   - version_label ('A' | 'B' | 'C' — default 'A')

3. `exam_lab_assets` — Uploaded educational content files
   - id (uuid PK)
   - exam_id (FK → exam_lab_exams, CASCADE)
   - file_name, file_type, file_url (storage path)
   - file_order (int)
   - extracted_text (text — OCR/analysis result)

4. `exam_lab_prompts` — Generated Gemini Notebook prompts
   - id (uuid PK)
   - exam_id (FK → exam_lab_exams, CASCADE)
   - prompt_text (text — the full generated prompt)
   - is_edited (boolean)

5. `exam_lab_question_bank` — Approved questions saved for reuse
   - id (uuid PK)
   - question_text, question_type, subject, stage_name, grade_name
   - lesson, difficulty, marks, answer, source_exam_id
   - created_at

6. `exam_lab_versions` — Multiple exam versions (A/B/C)
   - id (uuid PK)
   - exam_id (FK → exam_lab_exams, CASCADE)
   - version_label ('A' | 'B' | 'C')
   - question_order (jsonb — array of question IDs in order)
   - created_at

## Security
- RLS enabled on all tables
- Owner-scoped CRUD via auth.uid() on all tables
- All tables have user_id column defaulting to auth.uid()
*/

-- 1. exam_lab_exams
CREATE TABLE IF NOT EXISTS exam_lab_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  teacher_name text NOT NULL DEFAULT '',
  teacher_phone text NOT NULL DEFAULT '',
  center_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  stage_id uuid REFERENCES academic_stages(id) ON DELETE SET NULL,
  grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  stage_name text NOT NULL DEFAULT '',
  grade_name text NOT NULL DEFAULT '',
  group_name text NOT NULL DEFAULT '',
  book_name text NOT NULL DEFAULT '',
  unit_name text NOT NULL DEFAULT '',
  chapter_name text NOT NULL DEFAULT '',
  lessons text NOT NULL DEFAULT '',
  exam_title text NOT NULL DEFAULT '',
  exam_date date,
  duration_minutes integer NOT NULL DEFAULT 60,
  total_marks numeric NOT NULL DEFAULT 0,
  generation_mode text NOT NULL DEFAULT 'platform',
  template text NOT NULL DEFAULT 'classic',
  status text NOT NULL DEFAULT 'draft',
  difficulty text NOT NULL DEFAULT 'mixed',
  question_types jsonb NOT NULL DEFAULT '{}',
  extracted_content text NOT NULL DEFAULT '',
  answer_key jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_exams" ON exam_lab_exams;
CREATE POLICY "select_own_exam_lab_exams" ON exam_lab_exams FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_exams" ON exam_lab_exams;
CREATE POLICY "insert_own_exam_lab_exams" ON exam_lab_exams FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_exams" ON exam_lab_exams;
CREATE POLICY "update_own_exam_lab_exams" ON exam_lab_exams FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_exams" ON exam_lab_exams;
CREATE POLICY "delete_own_exam_lab_exams" ON exam_lab_exams FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 2. exam_lab_questions
CREATE TABLE IF NOT EXISTS exam_lab_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  exam_id uuid NOT NULL REFERENCES exam_lab_exams(id) ON DELETE CASCADE,
  question_text text NOT NULL DEFAULT '',
  question_type text NOT NULL DEFAULT 'mcq',
  marks numeric NOT NULL DEFAULT 1,
  difficulty text NOT NULL DEFAULT 'medium',
  source_lesson text NOT NULL DEFAULT '',
  choices jsonb NOT NULL DEFAULT '[]',
  correct_answer text NOT NULL DEFAULT '',
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_approved boolean NOT NULL DEFAULT false,
  version_label text NOT NULL DEFAULT 'A',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_questions" ON exam_lab_questions;
CREATE POLICY "select_own_exam_lab_questions" ON exam_lab_questions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_questions" ON exam_lab_questions;
CREATE POLICY "insert_own_exam_lab_questions" ON exam_lab_questions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_questions" ON exam_lab_questions;
CREATE POLICY "update_own_exam_lab_questions" ON exam_lab_questions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_questions" ON exam_lab_questions;
CREATE POLICY "delete_own_exam_lab_questions" ON exam_lab_questions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 3. exam_lab_assets
CREATE TABLE IF NOT EXISTS exam_lab_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  exam_id uuid NOT NULL REFERENCES exam_lab_exams(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT '',
  file_type text NOT NULL DEFAULT '',
  file_url text NOT NULL DEFAULT '',
  file_order integer NOT NULL DEFAULT 0,
  extracted_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_assets" ON exam_lab_assets;
CREATE POLICY "select_own_exam_lab_assets" ON exam_lab_assets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_assets" ON exam_lab_assets;
CREATE POLICY "insert_own_exam_lab_assets" ON exam_lab_assets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_assets" ON exam_lab_assets;
CREATE POLICY "update_own_exam_lab_assets" ON exam_lab_assets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_assets" ON exam_lab_assets;
CREATE POLICY "delete_own_exam_lab_assets" ON exam_lab_assets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 4. exam_lab_prompts
CREATE TABLE IF NOT EXISTS exam_lab_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  exam_id uuid NOT NULL REFERENCES exam_lab_exams(id) ON DELETE CASCADE,
  prompt_text text NOT NULL DEFAULT '',
  is_edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_prompts" ON exam_lab_prompts;
CREATE POLICY "select_own_exam_lab_prompts" ON exam_lab_prompts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_prompts" ON exam_lab_prompts;
CREATE POLICY "insert_own_exam_lab_prompts" ON exam_lab_prompts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_prompts" ON exam_lab_prompts;
CREATE POLICY "update_own_exam_lab_prompts" ON exam_lab_prompts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_prompts" ON exam_lab_prompts;
CREATE POLICY "delete_own_exam_lab_prompts" ON exam_lab_prompts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 5. exam_lab_question_bank
CREATE TABLE IF NOT EXISTS exam_lab_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  question_text text NOT NULL DEFAULT '',
  question_type text NOT NULL DEFAULT 'mcq',
  subject text NOT NULL DEFAULT '',
  stage_name text NOT NULL DEFAULT '',
  grade_name text NOT NULL DEFAULT '',
  lesson text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'medium',
  marks numeric NOT NULL DEFAULT 1,
  answer text NOT NULL DEFAULT '',
  source_exam_id uuid REFERENCES exam_lab_exams(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_question_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_qb" ON exam_lab_question_bank;
CREATE POLICY "select_own_exam_lab_qb" ON exam_lab_question_bank FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_qb" ON exam_lab_question_bank;
CREATE POLICY "insert_own_exam_lab_qb" ON exam_lab_question_bank FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_qb" ON exam_lab_question_bank;
CREATE POLICY "update_own_exam_lab_qb" ON exam_lab_question_bank FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_qb" ON exam_lab_question_bank;
CREATE POLICY "delete_own_exam_lab_qb" ON exam_lab_question_bank FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 6. exam_lab_versions
CREATE TABLE IF NOT EXISTS exam_lab_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  exam_id uuid NOT NULL REFERENCES exam_lab_exams(id) ON DELETE CASCADE,
  version_label text NOT NULL DEFAULT 'A',
  question_order jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_lab_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_exam_lab_versions" ON exam_lab_versions;
CREATE POLICY "select_own_exam_lab_versions" ON exam_lab_versions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_exam_lab_versions" ON exam_lab_versions;
CREATE POLICY "insert_own_exam_lab_versions" ON exam_lab_versions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_exam_lab_versions" ON exam_lab_versions;
CREATE POLICY "update_own_exam_lab_versions" ON exam_lab_versions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_exam_lab_versions" ON exam_lab_versions;
CREATE POLICY "delete_own_exam_lab_versions" ON exam_lab_versions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_lab_exams_user ON exam_lab_exams(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_lab_questions_exam ON exam_lab_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_lab_assets_exam ON exam_lab_assets(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_lab_prompts_exam ON exam_lab_prompts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_lab_qb_user ON exam_lab_question_bank(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_lab_versions_exam ON exam_lab_versions(exam_id);
