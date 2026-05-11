/* AUTHENTICATION ROUTES
- handles user registration and login with Supabase Auth
- manages Supabase Auth sessions and database user records */
const express = require("express");
const prisma = require("../config/prisma");
const { createRateLimiter } = require("../middleware/rate-limiter");
const { supabaseAdmin, supabaseClient } = require("../config/supabase-auth");
const { errorResponse, ErrorCodes } = require("../utils/errorResponse");
const { validate } = require("../middleware/validate");
const {
  registerBody,
  loginBody,
  forgotPasswordBody,
  resetPasswordBody,
  updateEmailBody,
  updatePasswordBody,
} = require("../schemas/auth.schemas");
const { hashForLog } = require("../utils/pii");

const router = express.Router();

// Rate limiting for auth routes (prevent brute force attacks) - PostgreSQL-backed
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per IP
  message: "Too many authentication attempts, please try again later",
}, "auth");

/* POST /api/auth/register
- creates new user in Supabase Auth and database
- validates email uniqueness */
router.post("/auth/register", authLimiter, validate({ body: registerBody }), async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body; // Already validated by Zod

    // checks if user already exists in database
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return errorResponse.conflict(res, "User with this email already exists", ErrorCodes.ALREADY_EXISTS);
    }

    // creates user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        firstName,
        lastName,
      },
    });

    if (authError) {
      req.log.error({ err: authError, emailHash: hashForLog(email) }, "Supabase user creation failed");
      return errorResponse.internal(res, "Registration failed. Please try again.");
    }

    // creates user in database
    const user = await prisma.user.create({
      data: {
        email,
        supabaseId: authData.user.id,
        firstName,
        lastName,
        password: null, // Password managed by Supabase
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });

    req.log.info({ userId: user.id, emailHash: hashForLog(user.email) }, "User registered");

    res.status(201).json({
      message: "User created successfully",
      user,
      session: authData.session,
    });
  } catch (err) {
    req.log.error({ err, emailHash: hashForLog(req.body?.email) }, "Registration failed");
    errorResponse.internal(res, "Registration failed. Please try again.");
  }
});

/* POST /api/auth/login
- authenticates user with Supabase Auth
- returns Supabase session and user data */
router.post("/auth/login", authLimiter, validate({ body: loginBody }), async (req, res) => {
  try {
    const { email, password } = req.body; // Already validated by Zod

    // finds user in database first to check isActive
    const dbUser = await prisma.user.findUnique({
      where: { email }
    });

    if (!dbUser) {
      return errorResponse.unauthorized(res, "Invalid email or password", ErrorCodes.INVALID_CREDENTIALS);
    }

    // checks if user account is active
    if (!dbUser.isActive) {
      return errorResponse.forbidden(res, "Account is disabled. Contact support.", ErrorCodes.ACCOUNT_DISABLED);
    }

    // authenticates with Supabase Auth
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      req.log.warn({ emailHash: hashForLog(email), error: error.message }, "Supabase login failed");
      return errorResponse.unauthorized(res, "Invalid email or password", ErrorCodes.INVALID_CREDENTIALS);
    }

    // updates last login timestamp
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { lastLogin: new Date() },
    });

    req.log.info({ userId: dbUser.id, emailHash: hashForLog(dbUser.email) }, "User logged in");

    res.json({
      session: data.session,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        role: dbUser.role,
      },
    });
  } catch (err) {
    req.log.error({ err, emailHash: hashForLog(req.body?.email) }, "Login failed");
    errorResponse.internal(res, "Login failed. Please try again.");
  }
});

/* POST /api/auth/forgot-password
- sends password reset email via Supabase Auth
- always returns success to prevent email enumeration */
router.post("/auth/forgot-password", validate({ body: forgotPasswordBody }), async (req, res) => {
  try {
    const { email } = req.body; // Already validated by Zod

    // Always attempt to send reset email - Supabase handles non-existent emails gracefully
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
    });

    if (error) {
      // Log error but don't expose to client (prevents email enumeration)
      req.log.warn({ emailHash: hashForLog(email), error: error.message }, "Password reset request failed");
    }

    // Always return success to prevent email enumeration
    res.json({
      message: "If an account exists with this email, a password reset link has been sent."
    });
  } catch (err) {
    req.log.error({ err, emailHash: hashForLog(req.body?.email) }, "Password reset request failed");
    // Still return success to prevent enumeration
    res.json({
      message: "If an account exists with this email, a password reset link has been sent."
    });
  }
});

/* POST /api/auth/reset-password
- updates user password after reset email verification
- requires valid Supabase session from reset link */
router.post("/auth/reset-password", validate({ body: resetPasswordBody }), async (req, res) => {
  try {
    const { password } = req.body; // Already validated by Zod

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse.unauthorized(res, "Invalid reset session", ErrorCodes.INVALID_TOKEN);
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return errorResponse.unauthorized(res, "Invalid or expired reset link", ErrorCodes.TOKEN_EXPIRED);
    }

    // Update the password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: password
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Password update failed");
      return errorResponse.internal(res, "Failed to update password. Please try again.");
    }

    req.log.info({ userId: user.id, emailHash: hashForLog(user.email) }, "Password reset successful");

    res.json({
      message: "Password has been reset successfully. You can now log in with your new password."
    });
  } catch (err) {
    req.log.error({ err }, "Password reset failed");
    errorResponse.internal(res, "Failed to reset password. Please try again.");
  }
});

/* PUT /api/auth/update-email
- updates user email in Supabase Auth and database
- requires valid Supabase session */
router.put("/auth/update-email", validate({ body: updateEmailBody }), async (req, res) => {
  try {
    const { email } = req.body; // Already validated by Zod

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse.unauthorized(res, "Authentication required", ErrorCodes.UNAUTHORIZED);
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the current user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return errorResponse.unauthorized(res, "Invalid session", ErrorCodes.INVALID_TOKEN);
    }

    // Check if the new email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser && existingUser.supabaseId !== user.id) {
      return errorResponse.conflict(res, "Email is already in use", ErrorCodes.ALREADY_EXISTS);
    }

    // Update email in Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: email,
      email_confirm: true
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Email update in Supabase failed");
      return errorResponse.internal(res, "Failed to update email. Please try again.");
    }

    // Update email in database
    await prisma.user.update({
      where: { supabaseId: user.id },
      data: { email }
    });

    req.log.info({ userId: user.id, oldEmailHash: hashForLog(user.email), newEmailHash: hashForLog(email) }, "Email updated successfully");

    res.json({
      message: "Email updated successfully"
    });
  } catch (err) {
    req.log.error({ err }, "Email update failed");
    errorResponse.internal(res, "Failed to update email. Please try again.");
  }
});

/* PUT /api/auth/update-password
- updates user password in Supabase Auth
- requires valid current password verification */
router.put("/auth/update-password", validate({ body: updatePasswordBody }), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body; // Already validated by Zod

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse.unauthorized(res, "Authentication required", ErrorCodes.UNAUTHORIZED);
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the current user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return errorResponse.unauthorized(res, "Invalid session", ErrorCodes.INVALID_TOKEN);
    }

    // Verify current password by attempting to sign in
    const { error: signInError } = await supabaseClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      return errorResponse.unauthorized(res, "Current password is incorrect", ErrorCodes.INVALID_CREDENTIALS);
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Password update failed");
      return errorResponse.internal(res, "Failed to update password. Please try again.");
    }

    req.log.info({ userId: user.id, emailHash: hashForLog(user.email) }, "Password updated successfully");

    res.json({
      message: "Password updated successfully"
    });
  } catch (err) {
    req.log.error({ err }, "Password update failed");
    errorResponse.internal(res, "Failed to update password. Please try again.");
  }
});

/* POST /api/auth/logout
- signs out user from Supabase Auth */
router.post("/auth/logout", async (req, res) => {
  try {
    const authHeader = req.get("Authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");

      // Revoke the session in Supabase
      await supabaseAdmin.auth.admin.signOut(token);
    }

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    req.log.error({ err }, "Logout failed");
    errorResponse.internal(res, "Logout failed");
  }
});

module.exports = router;
