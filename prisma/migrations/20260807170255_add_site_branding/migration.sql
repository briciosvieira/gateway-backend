-- CreateTable
CREATE TABLE "site_branding" (
    "id" TEXT NOT NULL DEFAULT 'site-branding',
    "application_name" TEXT NOT NULL,
    "logo_data" BYTEA,
    "logo_mime_type" TEXT,
    "logo_file_name" TEXT,
    "logo_size_bytes" INTEGER,
    "logo_sha256" TEXT,
    "favicon_data" BYTEA,
    "favicon_mime_type" TEXT,
    "favicon_file_name" TEXT,
    "favicon_size_bytes" INTEGER,
    "favicon_sha256" TEXT,
    "brand_image_data" BYTEA,
    "brand_image_mime_type" TEXT,
    "brand_image_file_name" TEXT,
    "brand_image_size_bytes" INTEGER,
    "brand_image_sha256" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_branding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_branding_updated_at_idx" ON "site_branding"("updated_at");

-- AddForeignKey
ALTER TABLE "site_branding" ADD CONSTRAINT "site_branding_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_branding" ADD CONSTRAINT "site_branding_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
