/**
 * Unit tests for passport.js JWT strategy
 * Tests: JWT extraction, verification, and user lookup
 */

const jwt = require("jsonwebtoken");

// Mock prisma before requiring passport
jest.mock("../../src/config/prisma");
const prisma = require("../../src/config/prisma");

describe("Passport JWT Strategy", () => {
  let passport;
  let jwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://test";

    // Clear module cache and require fresh passport instance
    jest.resetModules();
    const passportModule = require("../../src/config/passport");
    passport = passportModule.passport;

    // Extract the JWT strategy that was configured
    jwtStrategy = passport._strategies.jwt;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("JWT extraction", () => {
    test("extracts JWT from Authorization Bearer header", () => {
      const token = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET);

      const mockReq = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };

      const extracted = jwtStrategy._jwtFromRequest(mockReq);
      expect(extracted).toBe(token);
    });

    test("extracts JWT from lowercase bearer header", () => {
      const token = jwt.sign({ id: "user-123" }, process.env.JWT_SECRET);

      const mockReq = {
        headers: {
          authorization: `bearer ${token}`,
        },
      };

      const extracted = jwtStrategy._jwtFromRequest(mockReq);
      expect(extracted).toBe(token);
    });

    test("returns null when no Authorization header present", () => {
      const mockReq = { headers: {} };
      const extracted = jwtStrategy._jwtFromRequest(mockReq);
      expect(extracted).toBeNull();
    });

    test("returns null when Authorization header is malformed", () => {
      const mockReq = {
        headers: {
          authorization: "NotBearer token",
        },
      };

      const extracted = jwtStrategy._jwtFromRequest(mockReq);
      expect(extracted).toBeNull();
    });
  });

  describe("JWT verification", () => {
    test("verifies valid JWT and loads user from database", async () => {
      const userId = "user-456";
      const mockUser = {
        id: userId,
        email: "test@example.com",
        role: "USER",
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      // Payload uses 'id' field (matching passport.js implementation)
      const payload = { id: userId };
      const done = jest.fn();

      await jwtStrategy._verify(payload, done);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(done).toHaveBeenCalledWith(null, mockUser);
    });

    test("returns false when user not found in database", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const payload = { id: "nonexistent-user" };
      const done = jest.fn();

      await jwtStrategy._verify(payload, done);

      expect(done).toHaveBeenCalledWith(null, false);
    });

    test("handles database errors gracefully", async () => {
      const dbError = new Error("Database connection failed");
      prisma.user.findUnique.mockRejectedValue(dbError);

      const payload = { id: "user-789" };
      const done = jest.fn();

      await jwtStrategy._verify(payload, done);

      expect(done).toHaveBeenCalledWith(dbError, false);
    });
  });

  describe("Token validation", () => {
    test("rejects JWT with invalid signature", () => {
      const token = jwt.sign({ id: "user-123" }, "wrong-secret");

      expect(() => {
        jwt.verify(token, process.env.JWT_SECRET);
      }).toThrow("invalid signature");
    });

    test("rejects expired JWT", () => {
      const token = jwt.sign(
        { id: "user-123" },
        process.env.JWT_SECRET,
        { expiresIn: "-1h" } // Already expired
      );

      expect(() => {
        jwt.verify(token, process.env.JWT_SECRET);
      }).toThrow("jwt expired");
    });

    test("accepts valid JWT within expiration", () => {
      const token = jwt.sign(
        { id: "user-123" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe("user-123");
    });
  });
});
