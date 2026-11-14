CREATE TABLE IF NOT EXISTS backup_20261114_oct_archive AS SELECT * FROM monthly_archives WHERE archive_month = '2026-10';
CREATE TABLE IF NOT EXISTS backup_20261114_oct_payments_full AS SELECT * FROM payments;
CREATE TABLE IF NOT EXISTS backup_20261114_oct_subscriptions_full AS SELECT * FROM monthly_subscriptions WHERE month_key = '2026-10';
CREATE TABLE IF NOT EXISTS backup_20261114_students_full AS SELECT * FROM students;
