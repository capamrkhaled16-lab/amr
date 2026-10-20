/*
# Expand exams table with full exam-builder fields

## Overview
Adds columns to support the complete "create exam" modal from the reference design:
- subject (text) — المادة
- seconds_per_question (int) — ثانية/سؤال timer
- total_score (numeric) — الدرجة الكلية
- is_random (boolean) — عشوائية الأسئلة
- is_draft (boolean) — حفظ كمسودة

## Changes to `exams`
All additive — no data loss.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'subject') THEN
    ALTER TABLE exams ADD COLUMN subject text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'seconds_per_question') THEN
    ALTER TABLE exams ADD COLUMN seconds_per_question int NOT NULL DEFAULT 60;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'total_score') THEN
    ALTER TABLE exams ADD COLUMN total_score numeric(6,2) NOT NULL DEFAULT 100;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'is_random') THEN
    ALTER TABLE exams ADD COLUMN is_random boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'is_draft') THEN
    ALTER TABLE exams ADD COLUMN is_draft boolean NOT NULL DEFAULT true;
  END IF;
END $$;
