-- Fix monthly_subscriptions rows where amount_due (110) doesn't match
-- the grade level's base_subscription (120) for 3rd Prep students.
-- These 5 rows were created with the old fee (110) before the grade level
-- was updated to 120. The students table and archive snapshots already
-- have the correct 120 value.
UPDATE monthly_subscriptions ms
SET amount_due = gl.base_subscription
FROM students s
JOIN groups g ON s.group_id = g.id
JOIN grade_levels gl ON g.grade_level_id = gl.id
WHERE ms.student_id = s.id
  AND s.is_exempt = false
  AND s.is_deleted = false
  AND ms.amount_due != gl.base_subscription
  AND gl.base_subscription > 0;