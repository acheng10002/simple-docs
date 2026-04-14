-- This migration syncs the migration history with the current database state.
-- All changes below were already applied via `prisma db push`.

-- Add PageSize and Orientation enums
CREATE TYPE "PageSize" AS ENUM ('letter', 'legal', 'a4', 'a3', 'tabloid');
CREATE TYPE "Orientation" AS ENUM ('portrait', 'landscape');

-- Add pageSize and orientation columns to Template
ALTER TABLE "Template" ADD COLUMN "pageSize" "PageSize";
ALTER TABLE "Template" ADD COLUMN "orientation" "Orientation";

-- Add pageSize and orientation columns to TemplateVersion
ALTER TABLE "TemplateVersion" ADD COLUMN "pageSize" "PageSize";
ALTER TABLE "TemplateVersion" ADD COLUMN "orientation" "Orientation";

-- Remove redundant indexes (covered by unique constraints or composite indexes)
DROP INDEX IF EXISTS "User_email_idx";
DROP INDEX IF EXISTS "User_supabaseId_idx";
DROP INDEX IF EXISTS "Folder_userId_idx";
DROP INDEX IF EXISTS "Folder_userId_parentId_idx";
DROP INDEX IF EXISTS "BatchJob_status_idx";
DROP INDEX IF EXISTS "ErrorLog_level_idx";

-- Add high-priority missing indexes for pagination queries
CREATE INDEX "MergeJob_userId_createdAt_idx" ON "MergeJob"("userId", "createdAt");
CREATE INDEX "BatchJob_userId_createdAt_idx" ON "BatchJob"("userId", "createdAt");
