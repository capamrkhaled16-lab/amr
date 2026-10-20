/*
# Grade-Level Pricing + Secondary Track Split
1. Add base_subscription column to grade_levels for per-grade pricing
2. Rename stages for clarity
3. Split 3rd Secondary into Biology and Geology tracks
4. Rename primary grades to include "ابتدائي" prefix
*/

-- 1. Add base_subscription to grade_levels
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'grade_levels' AND column_name = 'base_subscription') THEN
    ALTER TABLE grade_levels ADD COLUMN base_subscription numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 2. Rename stages for clarity
UPDATE academic_stages SET name = 'المرحلة الابتدائية' WHERE name = 'الابتدائية';
UPDATE academic_stages SET name = 'المرحلة الإعدادية' WHERE name = 'الإعدادية';
UPDATE academic_stages SET name = 'المرحلة الثانوية' WHERE name = 'الثانوية';

-- 3. Rename primary grades
UPDATE grade_levels SET name = 'الصف الرابع الابتدائي' WHERE name = 'الصف الرابع';
UPDATE grade_levels SET name = 'الصف الخامس الابتدائي' WHERE name = 'الصف الخامس';
UPDATE grade_levels SET name = 'الصف السادس الابتدائي' WHERE name = 'الصف السادس';

-- 4. Rename preparatory grades
UPDATE grade_levels SET name = 'الصف الأول الإعدادي' WHERE name = 'الصف الأول' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الإعدادية');
UPDATE grade_levels SET name = 'الصف الثاني الإعدادي' WHERE name = 'الصف الثاني' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الإعدادية');
UPDATE grade_levels SET name = 'الصف الثالث الإعدادي' WHERE name = 'الصف الثالث' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الإعدادية');

-- 5. Rename first two secondary grades
UPDATE grade_levels SET name = 'الصف الأول الثانوي' WHERE name = 'الصف الأول' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الثانوية');
UPDATE grade_levels SET name = 'الصف الثاني الثانوي' WHERE name = 'الصف الثاني' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الثانوية');

-- 6. Rename existing 3rd secondary to Biology track
UPDATE grade_levels SET name = 'الصف الثالث الثانوي - أحياء', sort_order = 3 WHERE name = 'الصف الثالث' AND stage_id = (SELECT id FROM academic_stages WHERE name = 'المرحلة الثانوية');

-- 7. Insert new Geology track for 3rd secondary
INSERT INTO grade_levels (stage_id, name, sort_order, base_subscription)
SELECT id, 'الصف الثالث الثانوي - جيولوجيا', 4, 0
FROM academic_stages
WHERE name = 'المرحلة الثانوية'
AND NOT EXISTS (
  SELECT 1 FROM grade_levels WHERE name = 'الصف الثالث الثانوي - جيولوجيا'
);

-- 8. Copy base_subscription from stage to grade_levels as default
UPDATE grade_levels gl
SET base_subscription = s.base_subscription
FROM academic_stages s
WHERE gl.stage_id = s.id AND gl.base_subscription = 0;
