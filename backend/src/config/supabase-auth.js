const { createClient } = require("@supabase/supabase-js");

// Admin client with service role (bypasses RLS)
// Use this for admin operations like creating users, verifying tokens
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Public client for standard auth operations
// Use this for user-facing operations like sign in
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabaseAdmin, supabaseClient };
