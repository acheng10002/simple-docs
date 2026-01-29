-- AlterTable: Make MergeJob.data nullable to avoid storing PII
ALTER TABLE "MergeJob" ALTER COLUMN "data" DROP NOT NULL;
