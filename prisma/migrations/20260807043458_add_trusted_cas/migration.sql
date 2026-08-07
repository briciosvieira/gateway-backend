-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'TRUSTED_CA';

-- CreateTable
CREATE TABLE "trusted_cas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "certificate_pem" TEXT NOT NULL,
    "fingerprint_sha256" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_cas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_cas_fingerprint_sha256_key" ON "trusted_cas"("fingerprint_sha256");

-- CreateIndex
CREATE INDEX "trusted_cas_created_by_id_idx" ON "trusted_cas"("created_by_id");

-- CreateIndex
CREATE INDEX "trusted_cas_active_idx" ON "trusted_cas"("active");

-- CreateIndex
CREATE INDEX "trusted_cas_valid_to_idx" ON "trusted_cas"("valid_to");

-- CreateIndex
CREATE INDEX "trusted_cas_created_at_idx" ON "trusted_cas"("created_at");

-- CreateIndex
CREATE INDEX "trusted_cas_name_idx" ON "trusted_cas"("name");

-- AddForeignKey
ALTER TABLE "trusted_cas" ADD CONSTRAINT "trusted_cas_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
