-- CreateEnum
CREATE TYPE "RequestLogAuthenticationMode" AS ENUM ('API_KEY', 'NONE');

-- AlterTable
ALTER TABLE "gateway_routes" ADD COLUMN     "requires_api_key" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "request_logs" ADD COLUMN     "authentication_mode" "RequestLogAuthenticationMode" NOT NULL DEFAULT 'API_KEY';

-- CreateIndex
CREATE INDEX "request_logs_authentication_mode_idx" ON "request_logs"("authentication_mode");
