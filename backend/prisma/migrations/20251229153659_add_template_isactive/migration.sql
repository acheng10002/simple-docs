-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Template_isActive_idx" ON "Template"("isActive");
