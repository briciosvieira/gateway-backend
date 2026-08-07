-- CreateEnum
CREATE TYPE "AllowedIpType" AS ENUM ('IPV4', 'IPV6', 'CIDR_IPV4', 'CIDR_IPV6');

-- CreateTable
CREATE TABLE "allowed_ips" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "type" "AllowedIpType" NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allowed_ips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allowed_ips_client_id_idx" ON "allowed_ips"("client_id");

-- CreateIndex
CREATE INDEX "allowed_ips_type_idx" ON "allowed_ips"("type");

-- CreateIndex
CREATE INDEX "allowed_ips_active_idx" ON "allowed_ips"("active");

-- CreateIndex
CREATE INDEX "allowed_ips_created_at_idx" ON "allowed_ips"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_ips_client_id_address_key" ON "allowed_ips"("client_id", "address");

-- AddForeignKey
ALTER TABLE "allowed_ips" ADD CONSTRAINT "allowed_ips_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
