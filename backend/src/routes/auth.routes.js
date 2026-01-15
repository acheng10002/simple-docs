/* AUTHENTICATION ROUTES
- handles user registration and login with Supabase Auth
- manages Supabase Auth sessions and database user records */
const express = require("express");
const prisma = require("../config/prisma");
const rateLimit = require("express-rate-limit");
const { supabaseAdmin, supabaseClient } = require("../config/supabase-auth");

const router = express.Router();

// Rate limiting for auth routes (prevent brute force attacks)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per IP
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

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

    // validates password strength (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters"
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
    console.log("DEBUG: Login attempt for email:", email);

    // validates required fields
    if (!email || !password) {
      console.log("DEBUG: Missing email or password");
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // finds user in database first to check isActive
    const dbUser = await prisma.user.findUnique({
      where: { email }
    });
    console.log("DEBUG: DB user found:", !!dbUser);

    if (!dbUser) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    // checks if user account is active
    if (!dbUser.isActive) {
      console.log("DEBUG: User is not active");
      return res.status(403).json({
        error: "Account is disabled. Contact support."
      });
    }

    // authenticates with Supabase Auth
    console.log("DEBUG: Calling Supabase auth...");
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    console.log("DEBUG: Supabase response - error:", error?.message, "success:", !!data?.session);

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
