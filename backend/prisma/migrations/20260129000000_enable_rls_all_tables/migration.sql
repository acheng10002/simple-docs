-- Enable Row Level Security on all public tables
-- Backend uses service_role which bypasses RLS, so this blocks direct PostgREST access
-- Note: When RLS is enabled, access is denied by default if no policy matches.
-- We only need policies for service_role; anon/authenticated are denied automatically.

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
