-- AlterTable
ALTER TABLE "gateway_routes" ADD COLUMN     "requires_allowed_ip" BOOLEAN NOT NULL DEFAULT true;
