// Mock dependencies BEFORE importing
jest.mock("../../src/config/supabase-auth");
jest.mock("../../src/config/prisma");

const authenticateSupabase = require("../../src/middleware/supabase-auth");
const { supabaseAdmin } = require("../../src/config/supabase-auth");
const prisma = require("../../src/config/prisma");

describe("Supabase Auth Middleware", () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      get: jest.fn(),
      log: {
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  describe("Authorization Header Validation", () => {
    test("should return 401 when Authorization header is missing", async () => {
      mockReq.get.mockReturnValue(null);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 401 when Authorization header is malformed", async () => {
      mockReq.get.mockReturnValue("InvalidHeader");

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should extract token from Bearer Authorization header", async () => {
      const mockToken = "test-token-123";
      mockReq.get.mockReturnValue(`Bearer ${mockToken}`);

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith(mockToken);
    });
  });

  describe("Supabase Token Verification", () => {
    test("should return 401 when Supabase token verification fails", async () => {
      mockReq.get.mockReturnValue("Bearer invalid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid JWT" },
      });

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Invalid token" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 401 when Supabase returns no user", async () => {
      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Invalid token" });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("Database User Lookup", () => {
    test("should return 401 when user not found in database", async () => {
      const mockSupabaseUser = {
        id: "supabase-user-123",
        email: "test@example.com",
      };

      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(null);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { supabaseId: mockSupabaseUser.id },
      });
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "User not found" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should return 403 when user account is inactive", async () => {
      const mockSupabaseUser = {
        id: "supabase-user-123",
        email: "test@example.com",
      };

      const mockDbUser = {
        id: "db-user-123",
        email: "test@example.com",
        supabaseId: "supabase-user-123",
        isActive: false,
      };

      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Account is disabled",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("Successful Authentication", () => {
    test("should attach user to request and call next() on success", async () => {
      const mockSupabaseUser = {
        id: "supabase-user-123",
        email: "test@example.com",
      };

      const mockDbUser = {
        id: "db-user-123",
        email: "test@example.com",
        supabaseId: "supabase-user-123",
        isActive: true,
        role: "user",
        firstName: "Test",
        lastName: "User",
      };

      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(mockDbUser);
      expect(mockReq.supabaseUser).toEqual(mockSupabaseUser);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    test("should work with minimal user object", async () => {
      const mockSupabaseUser = {
        id: "supabase-user-456",
        email: "minimal@example.com",
      };

      const mockDbUser = {
        id: "db-user-456",
        email: "minimal@example.com",
        supabaseId: "supabase-user-456",
        isActive: true,
      };

      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: mockSupabaseUser },
        error: null,
      });

      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(mockDbUser);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should return 401 on unexpected errors", async () => {
      mockReq.get.mockReturnValue("Bearer valid-token");

      supabaseAdmin.auth.getUser.mockRejectedValue(
        new Error("Network error")
      );

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Authentication failed",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test("should log errors when logger is available", async () => {
      mockReq.get.mockReturnValue("Bearer valid-token");

      const mockError = new Error("Database error");
      supabaseAdmin.auth.getUser.mockResolvedValue({
        data: { user: { id: "test-id" } },
        error: null,
      });
      prisma.user.findUnique.mockRejectedValue(mockError);

      await authenticateSupabase(mockReq, mockRes, mockNext);

      expect(mockReq.log.error).toHaveBeenCalledWith(
        { err: mockError },
        "Supabase auth middleware error"
      );
    });
  });
});
