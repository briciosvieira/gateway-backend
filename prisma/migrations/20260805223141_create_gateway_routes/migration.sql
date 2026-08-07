-- CreateEnum
CREATE TYPE "GatewayHttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- CreateTable
CREATE TABLE "gateway_routes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "destination_url" TEXT NOT NULL,
    "method" "GatewayHttpMethod" NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_routes_slug_key" ON "gateway_routes"("slug");

-- CreateIndex
CREATE INDEX "gateway_routes_client_id_idx" ON "gateway_routes"("client_id");

-- CreateIndex
CREATE INDEX "gateway_routes_method_idx" ON "gateway_routes"("method");

-- CreateIndex
CREATE INDEX "gateway_routes_active_idx" ON "gateway_routes"("active");

-- CreateIndex
CREATE INDEX "gateway_routes_created_at_idx" ON "gateway_routes"("created_at");

-- AddForeignKey
ALTER TABLE "gateway_routes" ADD CONSTRAINT "gateway_routes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
