/*
# October 2026 Archive — Fix student total_fees in archive JSON

## Problem
The October archive snapshot stored total_fees=0 for every student, causing
the archive to show all students as "paid" (since any payment >= 0).

## Fix
Update each student's total_fees in the archive JSON to the correct value
based on their grade level base_subscription and personal discount/exemption.

## Tables Modified
- monthly_archives: only the row where archive_month='2026-10'
  Only the archive_data->'students' array entries are updated.

## No Other Data Touched
- payments, students, monthly_subscriptions, attendance, sessions, grades — unchanged
*/

UPDATE monthly_archives ma
SET archive_data = jsonb_set(
  ma.archive_data,
  '{students}',
  (
    SELECT jsonb_agg(
      jsonb_set(
        s_elem,
        '{total_fees}',
        to_jsonb(
          CASE
            WHEN (s_elem->>'is_exempt')::boolean THEN 0
            WHEN (s_elem->>'discount_mode') = 'percent'
              AND (s_elem->>'discount_percent')::numeric > 0
            THEN GREATEST(0, ROUND((gl.base_subscription * (1 - (s_elem->>'discount_percent')::numeric / 100.0)) * 100) / 100)
            WHEN (s_elem->>'discount_mode') = 'fixed'
              AND (s_elem->>'discount_amount')::numeric > 0
            THEN GREATEST(0, gl.base_subscription - (s_elem->>'discount_amount')::numeric)
            WHEN (s_elem->>'discount_amount')::numeric > 0
            THEN GREATEST(0, gl.base_subscription - (s_elem->>'discount_amount')::numeric)
            ELSE gl.base_subscription
          END
        )
      )
    )
    FROM jsonb_array_elements(ma.archive_data->'students') AS s_elem
    LEFT JOIN groups g ON g.id::text = s_elem->>'group_id'
    LEFT JOIN grade_levels gl ON gl.id = g.grade_level_id
  ),
  true
),
  updated_at = now()
WHERE ma.archive_month = '2026-10';
