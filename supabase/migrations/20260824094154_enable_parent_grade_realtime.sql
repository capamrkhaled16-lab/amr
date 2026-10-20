/*
# Enable realtime for parent-visible academic updates

1. Purpose
- Allow the parent portal to receive grade, homework, and behavior changes immediately after a teacher saves them.

2. Modified tables
- `center_grades`: realtime updates for center exam, sheet, and recitation scores.
- `online_grades`: realtime updates for electronic exam scores.
- `homework_status`: realtime updates for homework evaluations.
- `behavior_eval`: realtime updates for behavior evaluations.

3. Security
- This changes only the realtime publication. Existing table permissions and row-level security policies remain unchanged.

4. Data safety
- No rows or columns are changed or removed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'center_grades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE center_grades;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'online_grades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE online_grades;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'homework_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE homework_status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'behavior_eval'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE behavior_eval;
  END IF;
END $$;