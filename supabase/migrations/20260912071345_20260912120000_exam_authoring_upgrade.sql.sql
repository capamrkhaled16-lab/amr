/*
# Exam Authoring System Upgrade — Professional Teacher-First Features

## Overview
This migration adds professional exam authoring capabilities on top of the existing exam system.
It does NOT alter existing tables or data — all new features use new tables and additive columns.

## New Tables
1. `exam_sections` — divides an exam into named sections (e.g., "Choose the correct answer", "Essay")
   - id, exam_id (FK→exams), title, instructions, sort_order, created_at
2. `question_bank` — reusable question library for teachers
   - id, teacher_id (optional), subject, grade_level_id (optional), topic, type, question_text, choices, correct_choice_index, model_answer, accepted_answers, points, tags, created_at, updated_at
3. `exam_variants` — alternative versions of the same exam (Version A/B/C)
   - id, exam_id (FK→exams), variant_label, question_order (jsonb array of question IDs), choice_order (jsonb map), is_active, created_at

## Additive Columns on Existing Tables
- `exam_questions`: section_id (nullable FK→exam_sections), accepted_answers (jsonb array for multi-answer matching)
- `exams`: lifecycle_status (text: draft/review/published/active/closed/archived), country, education_system, language, academic_year, term

## Security
- RLS enabled on all new tables with anon+authenticated CRUD (same pattern as existing exam tables — single-tenant app)
- All policies follow the existing exam_questions pattern

## Important Notes
- All columns are ADDITIVE — no existing column is dropped, renamed, or type-changed
- Existing rows get safe defaults (NULL or 'draft' for lifecycle_status)
- Existing exam data and workflows remain untouched
*/

-- ============================================================
-- 1. EXAM SECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esec_select" ON exam_sections;
CREATE POLICY "esec_select" ON exam_sections FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "esec_insert" ON exam_sections;
CREATE POLICY "esec_insert" ON exam_sections FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "esec_update" ON exam_sections;
CREATE POLICY "esec_update" ON exam_sections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "esec_delete" ON exam_sections;
CREATE POLICY "esec_delete" ON exam_sections FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 2. QUESTION BANK
-- ============================================================
CREATE TABLE IF NOT EXISTS question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id text,
  subject text,
  grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL,
  topic text,
  type text NOT NULL DEFAULT 'mcq',
  question_text text NOT NULL,
  choices jsonb,
  correct_choice_index int,
  model_answer text,
  accepted_answers jsonb,
  points numeric(6,2) NOT NULL DEFAULT 1,
  tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qb_select" ON question_bank;
CREATE POLICY "qb_select" ON question_bank FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "qb_insert" ON question_bank;
CREATE POLICY "qb_insert" ON question_bank FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "qb_update" ON question_bank;
CREATE POLICY "qb_update" ON question_bank FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "qb_delete" ON question_bank;
CREATE POLICY "qb_delete" ON question_bank FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 3. EXAM VARIANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  variant_label text NOT NULL DEFAULT 'A',
  question_order jsonb,
  choice_order jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE exam_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_select" ON exam_variants;
CREATE POLICY "ev_select" ON exam_variants FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ev_insert" ON exam_variants;
CREATE POLICY "ev_insert" ON exam_variants FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ev_update" ON exam_variants;
CREATE POLICY "ev_update" ON exam_variants FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ev_delete" ON exam_variants;
CREATE POLICY "ev_delete" ON exam_variants FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 4. ADDITIVE COLUMNS ON exam_questions
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_questions' AND column_name = 'section_id') THEN
    ALTER TABLE exam_questions ADD COLUMN section_id uuid REFERENCES exam_sections(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exam_questions' AND column_name = 'accepted_answers') THEN
    ALTER TABLE exam_questions ADD COLUMN accepted_answers jsonb;
  END IF;
END $$;

-- ============================================================
-- 5. ADDITIVE COLUMNS ON exams
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'lifecycle_status') THEN
    ALTER TABLE exams ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'draft';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'country') THEN
    ALTER TABLE exams ADD COLUMN country text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'education_system') THEN
    ALTER TABLE exams ADD COLUMN education_system text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'language') THEN
    ALTER TABLE exams ADD COLUMN language text DEFAULT 'ar';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'academic_year') THEN
    ALTER TABLE exams ADD COLUMN academic_year text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'term') THEN
    ALTER TABLE exams ADD COLUMN term text;
  END IF;
END $$;

-- ============================================================
-- 6. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_exam_sections_exam_id ON exam_sections(exam_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject);
CREATE INDEX IF NOT EXISTS idx_question_bank_type ON question_bank(type);
CREATE INDEX IF NOT EXISTS idx_exam_variants_exam_id ON exam_variants(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_section_id ON exam_questions(section_id);

-- ============================================================
-- 7. REALTIME
-- ============================================================
ALTER TABLE exam_sections REPLICA IDENTITY FULL;
ALTER TABLE question_bank REPLICA IDENTITY FULL;
ALTER TABLE exam_variants REPLICA IDENTITY FULL;
