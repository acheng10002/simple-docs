/* AUTHENTICATION ROUTES
- handles user registration and login with Supabase Auth
- manages Supabase Auth sessions and database user records */
const express = require("express");
const prisma = require("../config/prisma");
const { createRateLimiter } = require("../middleware/rate-limiter");
const { supabaseAdmin, supabaseClient } = require("../config/supabase-auth");

const router = express.Router();

// Password strength validation
function validatePasswordStrength(password) {
  const errors = [];
  if (password.length < 8) errors.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('at least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('at least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('at least one number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('at least one special character');
  return errors;
}

// Rate limiting for auth routes (prevent brute force attacks) - PostgreSQL-backed
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per IP
  message: "Too many authentication attempts, please try again later",
}, "auth");

/* POST /api/auth/register
- creates new user in Supabase Auth and database
- validates email uniqueness */
router.post("/auth/register", authLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // validates required fields
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // validates email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format"
      });
    }

    // validates password strength
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        error: `Password must contain ${passwordErrors.join(', ')}`
      });
    }

    // checks if user already exists in database
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        error: "User with this email already exists"
      });
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
      req.log.error({ err: authError, email }, "Supabase user creation failed");
      return res.status(500).json({
        error: "Registration failed. Please try again."
      });
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

    req.log.info({ userId: user.id, email: user.email }, "User registered");

    res.status(201).json({
      message: "User created successfully",
      user,
      session: authData.session,
    });
  } catch (err) {
    req.log.error({ err, email: req.body?.email }, "Registration failed");
    res.status(500).json({
      error: "Registration failed. Please try again."
    });
  }
});

/* POST /api/auth/login
- authenticates user with Supabase Auth
- returns Supabase session and user data */
router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // validates required fields
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // finds user in database first to check isActive
    const dbUser = await prisma.user.findUnique({
      where: { email }
    });

    if (!dbUser) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    // checks if user account is active
    if (!dbUser.isActive) {
      return res.status(403).json({
        error: "Account is disabled. Contact support."
      });
    }

    // authenticates with Supabase Auth
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      req.log.warn({ email, error: error.message }, "Supabase login failed");
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    // updates last login timestamp
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { lastLogin: new Date() },
    });

    req.log.info({ userId: dbUser.id, email: dbUser.email }, "User logged in");

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
    req.log.error({ err, email: req.body?.email }, "Login failed");
    res.status(500).json({
      error: "Login failed. Please try again."
    });
  }
});

/* POST /api/auth/forgot-password
- sends password reset email via Supabase Auth
- always returns success to prevent email enumeration */
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    // Always attempt to send reset email - Supabase handles non-existent emails gracefully
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password`,
    });

    if (error) {
      // Log error but don't expose to client (prevents email enumeration)
      req.log.warn({ email, error: error.message }, "Password reset request failed");
    }

    // Always return success to prevent email enumeration
    res.json({
      message: "If an account exists with this email, a password reset link has been sent."
    });
  } catch (err) {
    req.log.error({ err, email: req.body?.email }, "Password reset request failed");
    // Still return success to prevent enumeration
    res.json({
      message: "If an account exists with this email, a password reset link has been sent."
    });
  }
});

/* POST /api/auth/reset-password
- updates user password after reset email verification
- requires valid Supabase session from reset link */
router.post("/auth/reset-password", async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "Password is required"
      });
    }

    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        error: `Password must contain ${passwordErrors.join(', ')}`
      });
    }

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Invalid reset session"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return res.status(401).json({
        error: "Invalid or expired reset link"
      });
    }

    // Update the password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: password
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Password update failed");
      return res.status(500).json({
        error: "Failed to update password. Please try again."
      });
    }

    req.log.info({ userId: user.id, email: user.email }, "Password reset successful");

    res.json({
      message: "Password has been reset successfully. You can now log in with your new password."
    });
  } catch (err) {
    req.log.error({ err }, "Password reset failed");
    res.status(500).json({
      error: "Failed to reset password. Please try again."
    });
  }
});

/* PUT /api/auth/update-email
- updates user email in Supabase Auth and database
- requires valid Supabase session */
router.put("/auth/update-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    // validates email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format"
      });
    }

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the current user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return res.status(401).json({
        error: "Invalid session"
      });
    }

    // Check if the new email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser && existingUser.supabaseId !== user.id) {
      return res.status(409).json({
        error: "Email is already in use"
      });
    }

    // Update email in Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: email,
      email_confirm: true
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Email update in Supabase failed");
      return res.status(500).json({
        error: "Failed to update email. Please try again."
      });
    }

    // Update email in database
    await prisma.user.update({
      where: { supabaseId: user.id },
      data: { email }
    });

    req.log.info({ userId: user.id, oldEmail: user.email, newEmail: email }, "Email updated successfully");

    res.json({
      message: "Email updated successfully"
    });
  } catch (err) {
    req.log.error({ err }, "Email update failed");
    res.status(500).json({
      error: "Failed to update email. Please try again."
    });
  }
});

/* PUT /api/auth/update-password
- updates user password in Supabase Auth
- requires valid current password verification */
router.put("/auth/update-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({
        error: "Current password is required"
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        error: "New password is required"
      });
    }

    const passwordErrors = validatePasswordStrength(newPassword);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        error: `New password must contain ${passwordErrors.join(', ')}`
      });
    }

    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the current user
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(token);

    if (verifyError || !user) {
      return res.status(401).json({
        error: "Invalid session"
      });
    }

    // Verify current password by attempting to sign in
    const { error: signInError } = await supabaseClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      return res.status(401).json({
        error: "Current password is incorrect"
      });
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (updateError) {
      req.log.error({ error: updateError.message, userId: user.id }, "Password update failed");
      return res.status(500).json({
        error: "Failed to update password. Please try again."
      });
    }

    req.log.info({ userId: user.id, email: user.email }, "Password updated successfully");

    res.json({
      message: "Password updated successfully"
    });
  } catch (err) {
    req.log.error({ err }, "Password update failed");
    res.status(500).json({
      error: "Failed to update password. Please try again."
    });
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
    res.status(500).json({ error: "Logout failed" });
  }
});

module.exports = router;
