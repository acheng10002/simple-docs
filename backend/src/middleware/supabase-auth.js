const { supabaseAdmin } = require("../config/supabase-auth");
const prisma = require("../config/prisma");

/**
 * Supabase authentication middleware
 * Replaces Passport.js JWT authentication
 * Validates Supabase session tokens and loads user from database
 */
async function authenticateSupabase(req, res, next) {
  try {
    const authHeader = req.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify JWT with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      req.log?.warn({ error: error?.message }, "Invalid Supabase token");
      return res.status(401).json({ error: "Invalid token" });
    }

    // Load user from database using Supabase ID
    const dbUser = await prisma.user.findUnique({
      where: { supabaseId: user.id },
    });

    if (!dbUser) {
      req.log?.error({ supabaseId: user.id }, "User not found in database");
      return res.status(401).json({ error: "User not found" });
    }

    if (!dbUser.isActive) {
      req.log?.warn({ userId: dbUser.id }, "Inactive user attempted access");
      return res.status(403).json({ error: "Account is disabled" });
    }

    // Attach user to request (same pattern as passport)
    req.user = dbUser;
    req.supabaseUser = user; // Additional Supabase user info if needed

    next();
  } catch (err) {
    req.log?.error({ err }, "Supabase auth middleware error");
    res.status(401).json({ error: "Authentication failed" });
  }
}

module.exports = authenticateSupabase;
