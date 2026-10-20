/*
# Granular Assistant Permissions — View Access Per Module

1. New Columns on `assistants`
   - `can_view_subscriptions` (boolean, default false) — view the "إجمالي المجموعة" tab
   - `can_view_attendance` (boolean, default false) — view the attendance tab
   - `can_view_students` (boolean, default false) — view student management
   - `can_view_exams` (boolean, default false) — view the exams tab
   - `can_view_grades` (boolean, default false) — view the grades tab
   - `can_view_tracking` (boolean, default false) — view homework & behavior tab
   - `can_view_certificates` (boolean, default false) — view certificates tab
   - `can_view_parent_links` (boolean, default false) — view parent links tab
   - `can_view_hall_of_fame` (boolean, default false) — view hall of fame tab

2. Notes
   - Existing columns (can_view_finance, can_manage_attendance, can_manage_students,
     can_manage_exams, can_manage_subscriptions, can_view_results_only,
     can_edit_questions, can_live_monitor, can_print_reports, can_grade_essay, can_edit_grades)
     remain unchanged.
   - The new `can_view_*` columns control whether a tab is VISIBLE to the assistant.
   - The existing `can_manage_*` columns control whether the assistant can EDIT within that tab.
   - Master (teacher) always sees everything.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_subscriptions') THEN
    ALTER TABLE assistants ADD COLUMN can_view_subscriptions boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_attendance') THEN
    ALTER TABLE assistants ADD COLUMN can_view_attendance boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_students') THEN
    ALTER TABLE assistants ADD COLUMN can_view_students boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_exams') THEN
    ALTER TABLE assistants ADD COLUMN can_view_exams boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_grades') THEN
    ALTER TABLE assistants ADD COLUMN can_view_grades boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_tracking') THEN
    ALTER TABLE assistants ADD COLUMN can_view_tracking boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_certificates') THEN
    ALTER TABLE assistants ADD COLUMN can_view_certificates boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_parent_links') THEN
    ALTER TABLE assistants ADD COLUMN can_view_parent_links boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assistants' AND column_name = 'can_view_hall_of_fame') THEN
    ALTER TABLE assistants ADD COLUMN can_view_hall_of_fame boolean NOT NULL DEFAULT false;
  END IF;
END $$;
