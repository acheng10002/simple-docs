-- Enable Row Level Security on all public tables
-- Backend uses service_role which bypasses RLS, so this blocks direct PostgREST access

-- =====================
-- User table
-- =====================
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to User"
ON "User"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to User"
ON "User"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =====================
-- Folder table
-- =====================
ALTER TABLE "Folder" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to Folder"
ON "Folder"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to Folder"
ON "Folder"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =====================
-- Template table
-- =====================
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to Template"
ON "Template"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to Template"
ON "Template"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =====================
-- TemplateVersion table
-- =====================
ALTER TABLE "TemplateVersion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to TemplateVersion"
ON "TemplateVersion"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to TemplateVersion"
ON "TemplateVersion"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =====================
-- Field table
-- =====================
ALTER TABLE "Field" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to Field"
ON "Field"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to Field"
ON "Field"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- =====================
-- MergeJob table
-- =====================
ALTER TABLE "MergeJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to MergeJob"
ON "MergeJob"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Deny public access to MergeJob"
ON "MergeJob"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);
