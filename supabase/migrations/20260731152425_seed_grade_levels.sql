/*
# Seed default grade levels for each academic stage

## Overview
Populates grade_levels with the standard Egyptian education stages so the stepper has data immediately. Idempotent — only inserts rows that don't already exist.
*/

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الأول', 1 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الأول');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثاني', 2 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثاني');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثالث', 3 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثالث');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الرابع', 4 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الرابع');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الخامس', 5 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الخامس');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف السادس', 6 FROM academic_stages s WHERE s.name = 'الابتدائية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف السادس');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الأول', 1 FROM academic_stages s WHERE s.name = 'الإعدادية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الأول');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثاني', 2 FROM academic_stages s WHERE s.name = 'الإعدادية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثاني');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثالث', 3 FROM academic_stages s WHERE s.name = 'الإعدادية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثالث');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الأول', 1 FROM academic_stages s WHERE s.name = 'الثانوية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الأول');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثاني', 2 FROM academic_stages s WHERE s.name = 'الثانوية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثاني');

INSERT INTO grade_levels (stage_id, name, sort_order)
SELECT s.id, 'الصف الثالث', 3 FROM academic_stages s WHERE s.name = 'الثانوية'
AND NOT EXISTS (SELECT 1 FROM grade_levels g WHERE g.stage_id = s.id AND g.name = 'الصف الثالث');
