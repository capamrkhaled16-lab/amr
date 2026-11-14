UPDATE monthly_archives
SET archive_data = jsonb_set(
  archive_data,
  '{students}',
  (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(archive_data->'students') s WHERE jsonb_typeof(s) = 'object')
)
WHERE archive_month = '2026-10'
  AND jsonb_typeof(archive_data->'students') = 'array';
