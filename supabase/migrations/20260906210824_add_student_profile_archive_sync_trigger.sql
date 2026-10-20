-- Create a function that syncs student profile updates to all monthly_archives JSONB blobs
-- This ensures phone, parent_phone, name, gender, status updates propagate to archive snapshots
-- without creating duplicate records — it updates the existing student object in-place by ID.

CREATE OR REPLACE FUNCTION sync_student_profile_to_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update all archive snapshots that contain this student
  UPDATE monthly_archives
  SET 
    archive_data = jsonb_set(
      archive_data,
      '{students}',
      (
        SELECT jsonb_agg(
          CASE 
            WHEN elem->>'id' = NEW.id::text THEN
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        elem,
                        'phone', to_jsonb(NEW.phone)
                      ),
                      'parent_phone', to_jsonb(NEW.parent_phone)
                    ),
                    'name', to_jsonb(NEW.name)
                  ),
                  'gender', to_jsonb(NEW.gender)
                ),
                'status', to_jsonb(NEW.status)
              )
            ELSE elem
          END
        )
        FROM jsonb_array_elements(archive_data->'students') AS elem
      ),
      true
    ),
    updated_at = now()
  WHERE archive_data->'students' @> jsonb_build_array(jsonb_build_object('id', NEW.id::text));
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS sync_student_profile_archive_trigger ON students;
CREATE TRIGGER sync_student_profile_archive_trigger
  AFTER UPDATE OF phone, parent_phone, name, gender, status
  ON students
  FOR EACH ROW
  EXECUTE FUNCTION sync_student_profile_to_archive();
