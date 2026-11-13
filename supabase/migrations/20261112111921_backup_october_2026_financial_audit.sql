/*
# Backup October 2026 financial data before audit

1. Purpose
- Snapshot all October 2026 payment records, monthly subscriptions, and student fee fields
- These backup tables are non-RLS, read-only snapshots used to reverse corrections if needed
2. New Tables
- backup_20261112_oct_payments: full copy of payments where month_key = '2026-10'
- backup_20261112_oct_subscriptions: full copy of monthly_subscriptions where month_key = '2026-10'
- backup_20261112_students_fees: copy of student fee/exemption/discount fields for all students
3. Notes
- No RLS on backup tables; they are internal audit snapshots
- Original tables are untouched
*/

CREATE TABLE IF NOT EXISTS backup_20261112_oct_payments AS
SELECT * FROM payments WHERE month_key = '2026-10' OR target_archive_month = '2026-10';

CREATE TABLE IF NOT EXISTS backup_20261112_oct_subscriptions AS
SELECT * FROM monthly_subscriptions WHERE month_key = '2026-10';

CREATE TABLE IF NOT EXISTS backup_20261112_students_fees AS
SELECT id, group_id, name, total_fees, paid_fees, is_exempt, discount_type, discount_amount,
       discount_mode, discount_percent, fee_mode, pro_rata_sessions, join_month_key, status, is_deleted
FROM students;
