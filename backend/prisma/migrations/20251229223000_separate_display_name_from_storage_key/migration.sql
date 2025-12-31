-- Step 1: Add new columns as nullable first
ALTER TABLE "Template" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Template" ADD COLUMN "storageKey" TEXT;

-- Step 2: Migrate existing data
-- Extract original filename from stamped name (removes timestamp-UUID prefix)
UPDATE "Template"
SET
  "storageKey" = "name",
  "displayName" = regexp_replace("name", '^[0-9]+-[a-f0-9-]+-', '');

-- Step 3: Make columns required
ALTER TABLE "Template" ALTER COLUMN "displayName" SET NOT NULL;
ALTER TABLE "Template" ALTER COLUMN "storageKey" SET NOT NULL;

-- Step 4: Drop old name column
ALTER TABLE "Template" DROP COLUMN "name";
