// Mock dependencies BEFORE importing
jest.mock("../../src/config/supabase-auth");
jest.mock("../../src/config/prisma");

// Mock rate limiter to avoid database connection during tests
jest.mock("../../src/middleware/rate-limiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
  createUserRateLimiter: () => (req, res, next) => next(),
  createWeightedLimiter: () => () => (req, res, next) => next(),
}));

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
      password: "Password123!",
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
      expect(response.body.error.message).toBe("Email and password are required");
    });

    test("should return 400 when password is missing", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Email and password are required");
    });

    test("should return 400 for invalid email format", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "invalid-email", password: "password123" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Invalid email format");
    });

    test("should return 400 when password does not meet requirements", async () => {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ email: "test@example.com", password: "short" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("Password must contain");
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
      expect(response.body.error.message).toBe("User with this email already exists");
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
      expect(response.body.error.message).toBe("Registration failed. Please try again.");
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
      expect(response.body.error.message).toBe("Email and password are required");
    });

    test("should return 400 when password is missing", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Email and password are required");
    });

    test("should return 401 when user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginCredentials);

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid email or password");
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
      expect(response.body.error.message).toBe("Account is disabled. Contact support.");
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
      expect(response.body.error.message).toBe("Invalid email or password");
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
      expect(response.body.error.message).toBe("Logout failed");
    });
  });

  describe("POST /api/auth/forgot-password", () => {
    test("should return success message for existing user", async () => {
      supabaseClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        "If an account exists with this email, a password reset link has been sent."
      );
      expect(supabaseClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
        { redirectTo: expect.stringContaining("/reset-password") }
      );
    });

    test("should return same success message for non-existing user (prevents enumeration)", async () => {
      supabaseClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: { message: "User not found" },
      });

      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "nonexistent@example.com" });

      // Should still return 200 with same message to prevent email enumeration
      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        "If an account exists with this email, a password reset link has been sent."
      );
    });

    test("should return 400 when email is missing", async () => {
      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Email is required");
    });

    test("should return success even when Supabase throws an error", async () => {
      supabaseClient.auth.resetPasswordForEmail.mockRejectedValue(
        new Error("Network error")
      );

      const response = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "test@example.com" });

      // Should still return success to prevent enumeration
      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        "If an account exists with this email, a password reset link has been sent."
      );
    });
  });

  describe("POST /api/auth/reset-password", () => {
    const validToken = "valid-reset-token";
    const mockUser = {
      id: "supabase-123",
      email: "test@example.com",
    };

    test("should reset password successfully with valid token", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const response = await request(app)
        .post("/api/auth/reset-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ password: "NewPassword123!" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        "Password has been reset successfully. You can now log in with your new password."
      );
      expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith(validToken);
      expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
        mockUser.id,
        { password: "NewPassword123!" }
      );
    });

    test("should return 400 when password is missing", async () => {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Password is required");
    });

    test("should return 400 when password does not meet requirements", async () => {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ password: "short" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("Password must contain");
    });

    test("should return 401 when Authorization header is missing", async () => {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .send({ password: "NewPassword123!" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid reset session");
    });

    test("should return 401 when token is invalid", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      const response = await request(app)
        .post("/api/auth/reset-password")
        .set("Authorization", "Bearer invalid-token")
        .send({ password: "NewPassword123!" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid or expired reset link");
    });

    test("should return 500 when password update fails", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      const response = await request(app)
        .post("/api/auth/reset-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ password: "NewPassword123!" });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to update password. Please try again.");
    });
  });

  describe("PUT /api/auth/update-email", () => {
    const validToken = "valid-session-token";
    const mockUser = {
      id: "supabase-123",
      email: "current@example.com",
    };

    test("should update email successfully", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(null); // New email not in use

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: { user: { ...mockUser, email: "new@example.com" } },
        error: null,
      });

      prisma.user.update.mockResolvedValue({
        id: "db-123",
        email: "new@example.com",
      });

      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ email: "new@example.com" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Email updated successfully");
      expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
        mockUser.id,
        { email: "new@example.com", email_confirm: true }
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { supabaseId: mockUser.id },
        data: { email: "new@example.com" },
      });
    });

    test("should return 400 when email is missing", async () => {
      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Email is required");
    });

    test("should return 400 for invalid email format", async () => {
      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ email: "invalid-email" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Invalid email format");
    });

    test("should return 401 when Authorization header is missing", async () => {
      const response = await request(app)
        .put("/api/auth/update-email")
        .send({ email: "new@example.com" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Authentication required");
    });

    test("should return 401 when token is invalid", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", "Bearer invalid-token")
        .send({ email: "new@example.com" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid session");
    });

    test("should return 409 when email is already in use by another user", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue({
        id: "other-user",
        supabaseId: "other-supabase-id",
        email: "new@example.com",
      });

      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ email: "new@example.com" });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toBe("Email is already in use");
    });

    test("should allow updating to same email (no conflict with self)", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue({
        id: "db-123",
        supabaseId: mockUser.id, // Same user
        email: "current@example.com",
      });

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      prisma.user.update.mockResolvedValue({
        id: "db-123",
        email: "current@example.com",
      });

      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ email: "current@example.com" });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Email updated successfully");
    });

    test("should return 500 when Supabase update fails", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(null);

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      const response = await request(app)
        .put("/api/auth/update-email")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ email: "new@example.com" });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to update email. Please try again.");
    });
  });

  describe("PUT /api/auth/update-password", () => {
    const validToken = "valid-session-token";
    const mockUser = {
      id: "supabase-123",
      email: "test@example.com",
    };

    test("should update password successfully", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: {}, user: mockUser },
        error: null,
      });

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Password updated successfully");
      expect(supabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: mockUser.email,
        password: "OldPassword1!",
      });
      expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
        mockUser.id,
        { password: "NewPassword1!" }
      );
    });

    test("should return 400 when current password is missing", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ newPassword: "NewPassword1!" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("Current password is required");
    });

    test("should return 400 when new password is missing", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ currentPassword: "OldPassword1!" });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe("New password is required");
    });

    test("should return 400 when new password is too short", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "Short1!",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("at least 8 characters");
    });

    test("should return 400 when new password lacks uppercase", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "newpassword1!",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("uppercase");
    });

    test("should return 400 when new password lacks lowercase", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NEWPASSWORD1!",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("lowercase");
    });

    test("should return 400 when new password lacks number", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword!",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("number");
    });

    test("should return 400 when new password lacks special character", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("special character");
    });

    test("should return 401 when Authorization header is missing", async () => {
      const response = await request(app)
        .put("/api/auth/update-password")
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Authentication required");
    });

    test("should return 401 when token is invalid", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", "Bearer invalid-token")
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid session");
    });

    test("should return 401 when current password is incorrect", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "Invalid credentials" },
      });

      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "WrongPassword1!",
          newPassword: "NewPassword1!",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Current password is incorrect");
    });

    test("should return 500 when password update fails", async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      supabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: {}, user: mockUser },
        error: null,
      });

      supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      const response = await request(app)
        .put("/api/auth/update-password")
        .set("Authorization", `Bearer ${validToken}`)
        .send({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword1!",
        });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to update password. Please try again.");
    });
  });

  // Note: Rate limiting tests are skipped because express-rate-limit is mocked
  // to prevent interference with other tests. Rate limiting is tested separately
  // in integration tests with the actual rate limiter.
});
