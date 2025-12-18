/* AUTHENTICATION ROUTES
- handles user registration and login with bcrypt password hashing
- generates JWT tokens for authenticated sessions */
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("./prisma");
const rateLimit = require("express-rate-limit");

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
- creates new user with hashed password
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

    // checks if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        error: "User with this email already exists"
      });
    }

    // hashes password with bcrypt (10 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // creates user with hashed password
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
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
    });
  } catch (err) {
    req.log.error({ err, email: req.body?.email }, "Registration failed");
    res.status(500).json({
      error: "Registration failed. Please try again."
    });
  }
});

/* POST /api/auth/login
- authenticates user with email and password
- returns JWT token on success */
router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // validates required fields
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    // finds user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // generic error message (don't reveal if user exists)
    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    // checks if user account is active
    if (!user.isActive) {
      return res.status(403).json({
        error: "Account is disabled. Contact support."
      });
    }

    // compares provided password with hashed password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    // generates JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // token expires in 7 days
    );

    // updates last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    req.log.info({ userId: user.id, email: user.email }, "User logged in");

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    req.log.error({ err, email: req.body?.email }, "Login failed");
    res.status(500).json({
      error: "Login failed. Please try again."
    });
  }
});

module.exports = router;
