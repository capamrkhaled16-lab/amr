/*
# Add can_manage_exemptions permission to assistants

## Overview
Adds a new boolean column `can_manage_exemptions` to the `assistants` table,
allowing the manager to grant or revoke the ability to apply full exemptions
and flexible discounts to students.

## Security
- Existing RLS policies on `assistants` cover the new column.
*/

ALTER TABLE assistants ADD COLUMN IF NOT EXISTS can_manage_exemptions boolean NOT NULL DEFAULT false;
