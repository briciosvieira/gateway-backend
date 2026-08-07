-- CreateEnum
CREATE TYPE "RequestLogResult" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "request_logs" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "client_id" TEXT,
    "api_key_id" TEXT,
    "gateway_route_id" TEXT,
    "source_ip" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "public_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "result" "RequestLogResult" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "request_headers" JSONB,
    "request_query" JSONB,
    "request_body" JSONB,
    "response_headers" JSONB,
    "request_size_bytes" INTEGER,
    "response_size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "request_logs_request_id_key" ON "request_logs"("request_id");

-- CreateIndex
CREATE INDEX "request_logs_client_id_idx" ON "request_logs"("client_id");

-- CreateIndex
CREATE INDEX "request_logs_api_key_id_idx" ON "request_logs"("api_key_id");

-- CreateIndex
CREATE INDEX "request_logs_gateway_route_id_idx" ON "request_logs"("gateway_route_id");

-- CreateIndex
CREATE INDEX "request_logs_source_ip_idx" ON "request_logs"("source_ip");

-- CreateIndex
CREATE INDEX "request_logs_status_code_idx" ON "request_logs"("status_code");

-- CreateIndex
CREATE INDEX "request_logs_result_idx" ON "request_logs"("result");

-- CreateIndex
CREATE INDEX "request_logs_error_code_idx" ON "request_logs"("error_code");

-- CreateIndex
CREATE INDEX "request_logs_created_at_idx" ON "request_logs"("created_at");

-- CreateIndex
CREATE INDEX "request_logs_method_idx" ON "request_logs"("method");

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_gateway_route_id_fkey" FOREIGN KEY ("gateway_route_id") REFERENCES "gateway_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
