-- CreateEnum
CREATE TYPE "RequestOrigin" AS ENUM ('PUBLIC', 'INTERNAL');

-- AlterTable
ALTER TABLE "request_logs" ADD COLUMN     "attempted_at" TIMESTAMP(3),
ADD COLUMN     "destination_host" TEXT,
ADD COLUMN     "destination_ip" TEXT,
ADD COLUMN     "destination_url" TEXT,
ADD COLUMN     "public_endpoint" TEXT,
ADD COLUMN     "request_origin" "RequestOrigin",
ADD COLUMN     "response_body" JSONB,
ADD COLUMN     "source_host" TEXT,
ADD COLUMN     "upstream_status_code" INTEGER;

-- CreateIndex
CREATE INDEX "request_logs_attempted_at_idx" ON "request_logs"("attempted_at");

-- CreateIndex
CREATE INDEX "request_logs_request_origin_idx" ON "request_logs"("request_origin");

-- CreateIndex
CREATE INDEX "request_logs_source_host_idx" ON "request_logs"("source_host");

-- CreateIndex
CREATE INDEX "request_logs_destination_host_idx" ON "request_logs"("destination_host");

-- CreateIndex
CREATE INDEX "request_logs_destination_ip_idx" ON "request_logs"("destination_ip");
