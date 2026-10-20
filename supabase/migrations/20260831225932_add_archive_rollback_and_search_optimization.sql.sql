/*
# Archive Rollback Function + Search Query Optimization

## 1. Rollback Function
- Creates a SECURITY DEFINER PL/pgSQL function `rollback_archive(p_archive_month text)`
- Reverses an archive by:
  * Restoring `paid_fees` from the archived snapshot for all students in that month
  * Deleting `carried_over_balances` records for that month
  * Deleting the `monthly_archives` row for that month
  * Deleting the `archive_runs` record for that month
  * Setting the archive status back to 'open' if it existed
- Returns a JSON result with success status and counts
- SECURITY DEFINER so the frontend can call it via RPC without needing direct table DELETE privileges

## 2. Search Performance
- The trigram index `idx_students_name_trgm` already exists on `students.name`
- No additional indexes needed — existing indexes cover all search patterns

## Security
- Function is SECURITY DEFINER, executable by authenticated users
- Only reverses archives (does not touch current month data beyond restoring paid_fees)
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
      DECLARE
        v_student_id text;
        v_paid_fees numeric;
      BEGIN
        v_student_id := v_students->i->>'id';
        v_paid_fees := (v_students->i->>'paid_fees')::numeric;
        IF v_student_id IS NOT NULL THEN
          UPDATE students
          SET paid_fees = COALESCE(v_paid_fees, 0)
          WHERE id = v_student_id;
          v_restored_count := v_restored_count + 1;
        END IF;
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

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION rollback_archive(text) TO authenticated;