-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "Folder_userId_parentId_idx" ON "Folder"("userId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_userId_parentId_name_key" ON "Folder"("userId", "parentId", "name");

-- CreateIndex
CREATE INDEX "Template_folderId_idx" ON "Template"("folderId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add check constraint for depth validation
ALTER TABLE "Folder" ADD CONSTRAINT "folder_depth_check" CHECK (depth >= 1 AND depth <= 4);

-- Create trigger function for hierarchy validation
CREATE OR REPLACE FUNCTION validate_folder_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  current_parent_id TEXT;
  depth_count INT := 1;
BEGIN
  -- If no parent, depth must be 1
  IF NEW."parentId" IS NULL THEN
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  -- Traverse up the tree to check for cycles and calculate depth
  current_parent_id := NEW."parentId";

  WHILE current_parent_id IS NOT NULL LOOP
    -- Check if we've hit the folder being modified (cycle detection)
    IF current_parent_id = NEW.id THEN
      RAISE EXCEPTION 'Circular folder reference detected';
    END IF;

    depth_count := depth_count + 1;

    -- Check max depth
    IF depth_count > 4 THEN
      RAISE EXCEPTION 'Maximum folder depth of 4 exceeded';
    END IF;

    -- Move to next parent
    SELECT "parentId" INTO current_parent_id
    FROM "Folder"
    WHERE id = current_parent_id;
  END LOOP;

  -- Set calculated depth
  NEW.depth := depth_count;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to Folder table
CREATE TRIGGER check_folder_hierarchy
  BEFORE INSERT OR UPDATE ON "Folder"
  FOR EACH ROW
  EXECUTE FUNCTION validate_folder_hierarchy();
