-- Enable realtime on exam_submissions so the live monitoring dashboard
-- receives instant updates when students join, start, submit, or get flagged.
-- Without this, the realtime subscription silently never fires and the
-- dashboard relies solely on 5-second polling, which can miss rapid changes.

ALTER PUBLICATION supabase_realtime ADD TABLE exam_submissions;