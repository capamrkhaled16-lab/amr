-- Enable realtime for exams, homework, and group_transfers so the parent
-- portal sees changes to these tables instantly. center_exams and
-- homework_status are already published, but the parent exam titles come
-- from the `exams` table (online exams) and homework titles from `homework`,
-- so edits there must propagate too. group_transfers had REPLICA IDENTITY
-- FULL set but was never added to the publication.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'exams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exams;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'homework'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.homework;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_transfers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_transfers;
  END IF;
END $$;
