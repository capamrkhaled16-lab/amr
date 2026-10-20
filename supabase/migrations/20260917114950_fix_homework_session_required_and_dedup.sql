-- Delete the older empty duplicate homework record (no statuses attached)
DELETE FROM homework
WHERE id = 'cec6cfaf-656f-45a4-bfe1-3b3690dc9d88';

-- Add NOT NULL constraint on session_id so homework cannot exist without a session
ALTER TABLE homework ALTER COLUMN session_id SET NOT NULL;

-- Add unique constraint to prevent duplicate homework per session+title
ALTER TABLE homework
  ADD CONSTRAINT homework_session_title_unique UNIQUE (session_id, title);