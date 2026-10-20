-- Add can_delete_evals permission to assistants table
ALTER TABLE assistants ADD COLUMN IF NOT EXISTS can_delete_evals boolean DEFAULT false;

-- Grant can_delete_evals to existing assistants who already have can_edit_grades
UPDATE assistants SET can_delete_evals = true WHERE can_edit_grades = true;
