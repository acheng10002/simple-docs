// Mock dependencies BEFORE importing
jest.mock("../../src/config/supabase-auth");
jest.mock("../../src/config/prisma");

// Mock rate limiter to prevent 429 errors in tests
jest.mock("express-rate-limit", () => {
  return jest.fn(() => (req, res, next) => next());
});

const request = require("supertest");
const express = require("express");
const authRouter = require("../../src/routes/auth.routes");
const { supabaseAdmin, supabaseClient } = require("../../src/config/supabase-auth");
const prisma = require("../../src/config/prisma");

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Add mock logger to requests
  app.use((req, res, next) => {
    req.log = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    next();
  });

  app.use("/api", authRouter);
  return app;
};

describe("Supabase Auth Routes", () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe("POST /api/auth/register", () => {
    const validRegistration = {
      email: "newuser@example.com",
      password: "password123",
      firstName: "New",
      lastName: "User",
    };

    test("should register a new user successfully", async () => {
      const mockSupabaseUser = {
        id: "supabase-123",
        email: validRegistration.email,
      };

      const mockDbUser = {
        id: "db-123",
        email: validRegistration.email,
        firstName: "New",
        lastName: "User",
        role: "user",
        createdAt: new Date().toISOString(),
      };

      const mockSession = {
        access_token: "access-token-123",
        refresh_token: "refresh-token-123",
      };

      prisma.user.findUnique.mockResolvedValue(null); // User doesn't exist

      supabaseAdmin.auth.admin.createUser.mockResolvedValue({
        data: {
          user: mockSupabaseUser,
          session: mockSession,
        },
        error: null,
      });

      prisma.user.create.mockResolvedValue(mockDbUser);

      const response = await request(app)
        .post("/api/auth/register")
        .send(validRegistration);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("message", "User created successfully");
      expect(response.body).toHaveProperty("user");
      expect(response.body).toHaveProperty("session");
      expect(response.body.user).toEqual(mockDbUser);

      expect(supabaseAdmin.auth.admin.createUser).toHaveBeenCalledWith({
        email: validRegistration.email,
        password: validRegistration.password,
        email_confirm: true,
        user_metadata: {
          firstName: validRegistration.firstName,
          lastName: validRegistration.lastName,
        },
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: validRegistration.email,
          supabaseId: mockSupabaseUser.id,
          firstName: validRegistration.firstName,
          lastName: validRegistration.lastName,
          password: null,
        },
        select: expect.any(Object),
      });
    });

    test("should return 400 when email is missing", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Email and password are required");
    });

    test("should return 400 when password is missing", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Email and password are required");
    });

    test("should return 400 for invalid email format", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "invalid-email", password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid email format");
    });

    test("should return 400 when password is too short", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "test@example.com", password: "short" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Password must be at least 8 characters");
    });

    test("should return 409 when user already exists", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "existing-user",
        email: validRegistration.email,
      });

      const response = await request(app)
        .post("/api/auth/register")
        .send(validRegistration);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("User with this email already exists");
    });

    test("should return 500 when Supabase user creation fails", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      supabaseAdmin.auth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Supabase error" },
      });

      const response = await request(app)
        .post("/api/auth/register")
        .send(validRegistration);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Registration failed. Please try again.");
    });
  });

  describe("POST /api/auth/login", () => {
    const loginCredentials = {
      email: "test@example.com",
      password: "password123",
    };

    test("should login user successfully", async () => {
      const mockDbUser = {
        id: "db-123",
        email: loginCredentials.email,
        isActive: true,
        firstName: "Test",
        lastName: "User",
        role: "user",
      };

      const mockSession = {
        access_token: "access-token-123",
        refresh_token: "refresh-token-123",
        user: { id: "supabase-123" },
      };

      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: mockSession,
          user: mockSession.user,
        },
        error: null,
      });

      prisma.user.update.mockResolvedValue(mockDbUser);

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("session");
      expect(response.body).toHaveProperty("user");
      expect(response.body.user.email).toBe(loginCredentials.email);

      expect(supabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: loginCredentials.email,
        password: loginCredentials.password,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockDbUser.id },
        data: { lastLogin: expect.any(Date) },
      });
    });

    test("should return 400 when email is missing", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Email and password are required");
    });

    test("should return 400 when password is missing", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Email and password are required");
    });

    test("should return 401 when user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid email or password");
    });

    test("should return 403 when account is inactive", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "db-123",
        email: loginCredentials.email,
        isActive: false,
      });

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Account is disabled. Contact support.");
    });

    test("should return 401 when Supabase authentication fails", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "db-123",
        email: loginCredentials.email,
        isActive: true,
      });

      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "Invalid credentials" },
      });

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid email or password");
    });
  });

  describe("POST /api/auth/logout", () => {
    test("should logout user successfully with token", async () => {
      supabaseAdmin.auth.admin.signOut.mockResolvedValue({
        error: null,
      });

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Logged out successfully");
      expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith("test-token");
    });

    test("should logout successfully even without token", async () => {
      const response = await request(app).post("/api/auth/logout");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Logged out successfully");
      expect(supabaseAdmin.auth.admin.signOut).not.toHaveBeenCalled();
    });

    test("should return 500 when logout fails", async () => {
      supabaseAdmin.auth.admin.signOut.mockRejectedValue(
        new Error("Logout failed")
      );

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Logout failed");
    });
  });

  // Note: Rate limiting tests are skipped because express-rate-limit is mocked
  // to prevent interference with other tests. Rate limiting is tested separately
  // in integration tests with the actual rate limiter.
});
