-- Fix exam_lab RLS policies to match the app's custom auth model
-- The app uses sessionStorage-based PIN auth, NOT Supabase Auth
-- So auth.uid() always returns NULL, blocking all operations
-- All other tables in this app use open access (TO anon, authenticated, USING true)
-- because auth is enforced in the frontend

-- exam_lab_exams
DROP POLICY IF EXISTS "select_own_exam_lab_exams" ON exam_lab_exams;
DROP POLICY IF EXISTS "insert_own_exam_lab_exams" ON exam_lab_exams;
DROP POLICY IF EXISTS "update_own_exam_lab_exams" ON exam_lab_exams;
DROP POLICY IF EXISTS "delete_own_exam_lab_exams" ON exam_lab_exams;

CREATE POLICY "select_exam_lab_exams" ON exam_lab_exams FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_exams" ON exam_lab_exams FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_exams" ON exam_lab_exams FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_exams" ON exam_lab_exams FOR DELETE
  TO anon, authenticated USING (true);

-- exam_lab_questions
DROP POLICY IF EXISTS "select_own_exam_lab_questions" ON exam_lab_questions;
DROP POLICY IF EXISTS "insert_own_exam_lab_questions" ON exam_lab_questions;
DROP POLICY IF EXISTS "update_own_exam_lab_questions" ON exam_lab_questions;
DROP POLICY IF EXISTS "delete_own_exam_lab_questions" ON exam_lab_questions;

CREATE POLICY "select_exam_lab_questions" ON exam_lab_questions FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_questions" ON exam_lab_questions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_questions" ON exam_lab_questions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_questions" ON exam_lab_questions FOR DELETE
  TO anon, authenticated USING (true);

-- exam_lab_assets
DROP POLICY IF EXISTS "select_own_exam_lab_assets" ON exam_lab_assets;
DROP POLICY IF EXISTS "insert_own_exam_lab_assets" ON exam_lab_assets;
DROP POLICY IF EXISTS "update_own_exam_lab_assets" ON exam_lab_assets;
DROP POLICY IF EXISTS "delete_own_exam_lab_assets" ON exam_lab_assets;

CREATE POLICY "select_exam_lab_assets" ON exam_lab_assets FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_assets" ON exam_lab_assets FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_assets" ON exam_lab_assets FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_assets" ON exam_lab_assets FOR DELETE
  TO anon, authenticated USING (true);

-- exam_lab_prompts
DROP POLICY IF EXISTS "select_own_exam_lab_prompts" ON exam_lab_prompts;
DROP POLICY IF EXISTS "insert_own_exam_lab_prompts" ON exam_lab_prompts;
DROP POLICY IF EXISTS "update_own_exam_lab_prompts" ON exam_lab_prompts;
DROP POLICY IF EXISTS "delete_own_exam_lab_prompts" ON exam_lab_prompts;

CREATE POLICY "select_exam_lab_prompts" ON exam_lab_prompts FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_prompts" ON exam_lab_prompts FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_prompts" ON exam_lab_prompts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_prompts" ON exam_lab_prompts FOR DELETE
  TO anon, authenticated USING (true);

-- exam_lab_question_bank
DROP POLICY IF EXISTS "select_own_exam_lab_qb" ON exam_lab_question_bank;
DROP POLICY IF EXISTS "insert_own_exam_lab_qb" ON exam_lab_question_bank;
DROP POLICY IF EXISTS "update_own_exam_lab_qb" ON exam_lab_question_bank;
DROP POLICY IF EXISTS "delete_own_exam_lab_qb" ON exam_lab_question_bank;

CREATE POLICY "select_exam_lab_qb" ON exam_lab_question_bank FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_qb" ON exam_lab_question_bank FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_qb" ON exam_lab_question_bank FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_qb" ON exam_lab_question_bank FOR DELETE
  TO anon, authenticated USING (true);

-- exam_lab_versions
DROP POLICY IF EXISTS "select_own_exam_lab_versions" ON exam_lab_versions;
DROP POLICY IF EXISTS "insert_own_exam_lab_versions" ON exam_lab_versions;
DROP POLICY IF EXISTS "update_own_exam_lab_versions" ON exam_lab_versions;
DROP POLICY IF EXISTS "delete_own_exam_lab_versions" ON exam_lab_versions;

CREATE POLICY "select_exam_lab_versions" ON exam_lab_versions FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_exam_lab_versions" ON exam_lab_versions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_exam_lab_versions" ON exam_lab_versions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_exam_lab_versions" ON exam_lab_versions FOR DELETE
  TO anon, authenticated USING (true);
