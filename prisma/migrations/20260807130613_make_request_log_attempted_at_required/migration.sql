-- Backfill historical request logs with the best available fallback before
-- enforcing the column as mandatory for all future writes.
UPDATE "request_logs"
SET "attempted_at" = "created_at"
WHERE "attempted_at" IS NULL;

-- AlterTable
ALTER TABLE "request_logs" ALTER COLUMN "attempted_at" SET NOT NULL;
