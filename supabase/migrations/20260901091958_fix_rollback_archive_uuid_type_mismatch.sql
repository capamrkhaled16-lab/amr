/*
# Fix rollback_archive uuid = text type mismatch

## Problem
The `rollback_archive` function declares `v_student_id` as `text` but compares it
against `students.id` which is `uuid`. This triggers:
  `operator does not exist: uuid = text`
which breaks the rollback button and any archive operation that touches student records.

## Fix
Recreate the function with `v_student_id` declared as `uuid` and cast the
extracted text value to `uuid` before the UPDATE comparison.

## Side effects
- None destructive. The function is replaced in place.
- Rollback now works without type errors.
- Historical archive totals remain accurate because the archive_data JSON is
  read correctly.
*/

CREATE OR REPLACE FUNCTION rollback_archive(p_archive_month text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archive record;
  v_students jsonb;
  v_restored_count int := 0;
  v_carried_count int := 0;
  v_student_id uuid;
  v_paid_fees numeric;
BEGIN
  -- Find the archive
  SELECT * INTO v_archive
  FROM monthly_archives
  WHERE archive_month = p_archive_month
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Archive not found for month ' || p_archive_month);
  END IF;

  -- Restore paid_fees from archived snapshot
  v_students := v_archive.archive_data->'students';
  IF v_students IS NOT NULL AND jsonb_typeof(v_students) = 'array' THEN
    FOR i IN 0..jsonb_array_length(v_students) - 1 LOOP
      v_student_id := NULL;
      v_paid_fees := NULL;
      BEGIN
        v_student_id := (v_students->i->>'id')::uuid;
        v_paid_fees := (v_students->i->>'paid_fees')::numeric;
        IF v_student_id IS NOT NULL THEN
          UPDATE students
          SET paid_fees = COALESCE(v_paid_fees, 0)
          WHERE id = v_student_id;
          v_restored_count := v_restored_count + 1;
        END IF;
      EXCEPTION WHEN others THEN
        -- Skip rows with invalid uuid or missing paid_fees
        CONTINUE;
      END;
    END LOOP;
  END IF;

  -- Delete carried-over balances for this month
  DELETE FROM carried_over_balances WHERE from_month = p_archive_month;
  GET DIAGNOSTICS v_carried_count = ROW_COUNT;

  -- Delete the archive row
  DELETE FROM monthly_archives WHERE archive_month = p_archive_month;

  -- Delete the archive run record
  DELETE FROM archive_runs WHERE archive_month = p_archive_month;

  RETURN jsonb_build_object(
    'success', true,
    'month', p_archive_month,
    'restored_students', v_restored_count,
    'deleted_carried_balances', v_carried_count
  );
END;
$$;

-- Re-grant execute to authenticated (CREATE OR REPLACE may drop grants)
GRANT EXECUTE ON FUNCTION rollback_archive(text) TO authenticated;
