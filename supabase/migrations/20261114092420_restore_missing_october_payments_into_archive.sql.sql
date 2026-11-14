DO $$
DECLARE
  ma_id uuid;
  new_payments jsonb;
BEGIN
  SELECT id INTO ma_id FROM monthly_archives WHERE archive_month = '2026-10';

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at), '[]'::jsonb) INTO new_payments
  FROM payments p
  WHERE p.month_key = '2026-10'
    AND p.is_deleted = false
    AND p.student_id::text IN (
      SELECT s->>'id' FROM monthly_archives ma, jsonb_array_elements(ma.archive_data->'students') s WHERE ma.id = ma_id
    )
    AND p.student_id::text NOT IN (
      SELECT x->>'student_id' FROM monthly_archives ma, jsonb_array_elements(ma.archive_data->'payments') x
      WHERE ma.id = ma_id AND x->>'student_id' IS NOT NULL AND coalesce((x->>'is_deleted')::boolean, false) = false
    );

  UPDATE monthly_archives
  SET archive_data = jsonb_set(
    archive_data,
    '{payments}',
    coalesce(archive_data->'payments', '[]'::jsonb) || new_payments
  )
  WHERE id = ma_id AND jsonb_array_length(new_payments) > 0;

  UPDATE monthly_archives
  SET archive_data = jsonb_set(
    archive_data,
    '{students}',
    (
      SELECT jsonb_agg(
        CASE WHEN s->>'id' IN (SELECT p->>'student_id' FROM jsonb_array_elements(new_payments) p)
          THEN jsonb_set(s, '{paid_fees}', to_jsonb((SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(new_payments) p WHERE p->>'student_id' = s->>'id')))
          ELSE s
        END
      )
      FROM jsonb_array_elements(archive_data->'students') s
    )
  )
  WHERE id = ma_id AND jsonb_array_length(new_payments) > 0;
END $$;
