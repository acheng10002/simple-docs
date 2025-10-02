-- CreateEnum
CREATE TYPE "public"."OutputType" AS ENUM ('docx', 'pdf');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "public"."Template" (
    "id" TEXT NOT NULL,
    "mimeType" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Field" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MergeJob" (
    "id" SERIAL NOT NULL,
    "templateId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "outputType" "public"."OutputType" NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "filePath" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MergeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Field_templateId_name_key" ON "public"."Field"("templateId", "name");

-- CreateIndex
CREATE INDEX "MergeJob_templateId_idx" ON "public"."MergeJob"("templateId");

-- CreateIndex
CREATE INDEX "MergeJob_status_createdAt_idx" ON "public"."MergeJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Field" ADD CONSTRAINT "Field_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MergeJob" ADD CONSTRAINT "MergeJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
