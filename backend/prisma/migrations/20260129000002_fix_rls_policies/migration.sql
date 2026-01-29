-- Fix RLS policies: Remove redundant "deny" policies
-- When RLS is enabled, access is denied by default if no policy matches.
-- We only need permissive policies for service_role; anon/authenticated
-- will be denied automatically without needing explicit deny policies.

-- =====================
-- Field table
-- =====================
DROP POLICY IF EXISTS "Deny public access to Field" ON "Field";
DROP POLICY IF EXISTS "Service role has full access to fields" ON "Field";
DROP POLICY IF EXISTS "Service role has full access to Field" ON "Field";

-- Recreate single policy for service role
CREATE POLICY "Service role has full access to Field"
ON "Field"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- User table
-- =====================
DROP POLICY IF EXISTS "Deny public access to User" ON "User";
DROP POLICY IF EXISTS "Service role has full access to User" ON "User";

CREATE POLICY "Service role has full access to User"
ON "User"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- Folder table
-- =====================
DROP POLICY IF EXISTS "Deny public access to Folder" ON "Folder";
DROP POLICY IF EXISTS "Service role has full access to Folder" ON "Folder";

CREATE POLICY "Service role has full access to Folder"
ON "Folder"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- Template table
-- =====================
DROP POLICY IF EXISTS "Deny public access to Template" ON "Template";
DROP POLICY IF EXISTS "Service role has full access to Template" ON "Template";

CREATE POLICY "Service role has full access to Template"
ON "Template"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- TemplateVersion table
-- =====================
DROP POLICY IF EXISTS "Deny public access to TemplateVersion" ON "TemplateVersion";
DROP POLICY IF EXISTS "Service role has full access to TemplateVersion" ON "TemplateVersion";

CREATE POLICY "Service role has full access to TemplateVersion"
ON "TemplateVersion"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- MergeJob table
-- =====================
DROP POLICY IF EXISTS "Deny public access to MergeJob" ON "MergeJob";
DROP POLICY IF EXISTS "Service role has full access to MergeJob" ON "MergeJob";

CREATE POLICY "Service role has full access to MergeJob"
ON "MergeJob"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================
-- ErrorLog table
-- =====================
DROP POLICY IF EXISTS "Deny public access to ErrorLog" ON "ErrorLog";
DROP POLICY IF EXISTS "Service role has full access to ErrorLog" ON "ErrorLog";

CREATE POLICY "Service role has full access to ErrorLog"
ON "ErrorLog"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
