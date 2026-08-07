-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'ROUTE_HEADER';

-- CreateTable
CREATE TABLE "route_headers" (
    "id" TEXT NOT NULL,
    "gateway_route_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_headers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_headers_gateway_route_id_idx" ON "route_headers"("gateway_route_id");

-- CreateIndex
CREATE INDEX "route_headers_active_idx" ON "route_headers"("active");

-- CreateIndex
CREATE INDEX "route_headers_sensitive_idx" ON "route_headers"("sensitive");

-- CreateIndex
CREATE INDEX "route_headers_created_at_idx" ON "route_headers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "route_headers_gateway_route_id_name_key" ON "route_headers"("gateway_route_id", "name");

-- AddForeignKey
ALTER TABLE "route_headers" ADD CONSTRAINT "route_headers_gateway_route_id_fkey" FOREIGN KEY ("gateway_route_id") REFERENCES "gateway_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
