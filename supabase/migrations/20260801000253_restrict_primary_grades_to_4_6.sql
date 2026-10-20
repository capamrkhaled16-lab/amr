/*
# Restrict Primary School stage to grades 4-6 only

## Overview
The platform's Primary stage (الابتدائية) should only include grades 4, 5, and 6.
Grades 1-3 are removed from the Primary stage to match the center's scope.
Grades for other stages (الإعدادية, الثانوية) are unchanged.

## Safety
- Only deletes grade_levels rows under the 'الابتدائية' stage with sort_order 1, 2, or 3.
- Does NOT touch students, groups, or any other table.
- Groups referencing deleted grade levels are handled by the app filtering.
*/

DELETE FROM grade_levels
WHERE stage_id = (SELECT id FROM academic_stages WHERE name = 'الابتدائية')
  AND sort_order IN (1, 2, 3);
