/*
# Add month_key column to payments (stage 1: column only)

Adds a nullable `month_key` text column to `payments` and backfills it from
`payment_date` as "YYYY-MM". No unique index yet — duplicates are resolved
in a follow-up migration.
*/

ALTER TABLE payments ADD COLUMN IF NOT EXISTS month_key text;

UPDATE payments
SET month_key = to_char(payment_date, 'YYYY-MM')
WHERE month_key IS NULL;
