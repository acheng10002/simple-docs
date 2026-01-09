-- Enable Row Level Security on ErrorLog table
ALTER TABLE "ErrorLog" ENABLE ROW LEVEL SECURITY;

-- Create policy that allows service role to do everything
-- This ensures your backend (using service_role key) can still read/write
CREATE POLICY "Service role has full access to ErrorLog"
ON "ErrorLog"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Deny all access to authenticated and anonymous users
-- This prevents any public API access to error logs
CREATE POLICY "Deny public access to ErrorLog"
ON "ErrorLog"
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);