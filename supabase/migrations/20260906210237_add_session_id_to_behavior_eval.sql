-- Add session_id to behavior_eval to make sessions the central hub for all evaluations
ALTER TABLE behavior_eval ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;

-- Index for faster lookups by session
CREATE INDEX IF NOT EXISTS idx_behavior_eval_session_id ON behavior_eval(session_id) WHERE session_id IS NOT NULL;

-- Enable realtime for behavior_eval session link (already enabled on table, just ensuring)
