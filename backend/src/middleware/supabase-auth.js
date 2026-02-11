const { supabaseAdmin } = require("../config/supabase-auth");
const prisma = require("../config/prisma");
const { errorResponse, ErrorCodes } = require("../utils/errorResponse");

/**
 * Supabase authentication middleware
 * Replaces Passport.js JWT authentication
 * Validates Supabase session tokens and loads user from database
 */
async function authenticateSupabase(req, res, next) {
  try {
    const authHeader = req.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse.unauthorized(res, "Unauthorized", ErrorCodes.UNAUTHORIZED);
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify JWT with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      req.log?.warn({ error: error?.message }, "Invalid Supabase token");
      return errorResponse.unauthorized(res, "Invalid token", ErrorCodes.INVALID_TOKEN);
    }

    // Load user from database using Supabase ID
    const dbUser = await prisma.user.findUnique({
      where: { supabaseId: user.id },
    });

    if (!dbUser) {
      req.log?.error({ supabaseId: user.id }, "User not found in database");
      return errorResponse.unauthorized(res, "User not found", ErrorCodes.USER_NOT_FOUND);
    }

    if (!dbUser.isActive) {
      req.log?.warn({ userId: dbUser.id }, "Inactive user attempted access");
      return errorResponse.forbidden(res, "Account is disabled", ErrorCodes.ACCOUNT_DISABLED);
    }

    // Attach user to request (same pattern as passport)
    req.user = dbUser;
    req.supabaseUser = user; // Additional Supabase user info if needed

    next();
  } catch (err) {
    req.log?.error({ err }, "Supabase auth middleware error");
    errorResponse.unauthorized(res, "Authentication failed", ErrorCodes.AUTH_FAILED);
  }
}

module.exports = authenticateSupabase;
