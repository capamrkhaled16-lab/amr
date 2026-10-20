-- Fix: Preparatory stage base_subscription was 110, should be 120
-- This was causing parent portal to show 110 EGP fallback for students
-- with total_fees = 0 (e.g. exempt students or new students).
UPDATE academic_stages
SET base_subscription = 120
WHERE id = 'dfe3f8c8-00ac-4463-8eb5-b79a453fbd6b' AND base_subscription = 110;

-- Fix: 1st and 2nd preparatory grade levels also had 110, should be 120
-- 3rd preparatory was already correct at 120.
UPDATE grade_levels
SET base_subscription = 120
WHERE stage_id = 'dfe3f8c8-00ac-4463-8eb5-b79a453fbd6b'
  AND base_subscription = 110;
