/*
  Warnings:

  - Added the required column `level` to the `roles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "level" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "roles_level_idx" ON "roles"("level");
