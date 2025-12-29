const jwt = require("jsonwebtoken");

// mocks prisma before requiring passport
jest.mock("../../prisma", () => require("../../__mocks__/prisma"));
const prisma = require("../../prisma");

describe("Passport JWT Strategy", () => {
  let passport;
  let jwtStrategy;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://test";

    // clears the module cache to get fresh passport instance
    jest.resetModules();
    const passportModule = require("../../passport");
    passport = passportModule.passport;

    // extracts the JWT strategy that was configured
    jwtStrategy = passport._strategies.jwt;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should extract JWT from Authorization Bearer header", () => {
    const token = jwt.sign({ userId: "user-123" }, process.env.JWT_SECRET);

    const mockReq = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    // tests that the extractor function works
    const extracted = jwtStrategy._jwtFromRequest(mockReq);
    expect(extracted).toBe(token);
  });

  test("should verify valid JWT and load user from database", async () => {
    const userId = "user-456";
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: "test@example.com",
      role: "USER",
    });

    // decodes the token to get payload (simulating what passport does)
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // calls the verify function that passport uses
    const done = jest.fn();
    await jwtStrategy._verify(payload, done);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
    });

    expect(done).toHaveBeenCalledWith(null, {
      id: userId,
      email: "test@example.com",
      role: "USER",
    });
  });

  test("should reject JWT with invalid signature", () => {
    const token = jwt.sign({ userId: "user-123" }, "wrong-secret");

    expect(() => {
      jwt.verify(token, process.env.JWT_SECRET);
    }).toThrow("invalid signature");
  });

  test("should reject expired JWT", () => {
    const token = jwt.sign(
      { userId: "user-123" },
      process.env.JWT_SECRET,
      // already expired
      { expiresIn: "-1h" }
    );

    expect(() => {
      jwt.verify(token, process.env.JWT_SECRET);
    }).toThrow("jwt expired");
  });

  test("should return error when user not found in database", async () => {
    const userId = "nonexistent-user";
    const payload = { userId };

    prisma.user.findUnique.mockResolvedValue(null);

    const done = jest.fn();
    await jwtStrategy._verify(payload, done);

    expect(done).toHaveBeenCalledWith(null, false);
  });

  test("should handle database errors gracefully", async () => {
    const userId = "user-789";
    const payload = { userId };

    const dbError = new Error("Database connection failed");
    prisma.user.findUnique.mockResolvedValue(dbError);

    const done = jest.fn();
    await jwtStrategy._verify(payload, done);

    expect(done).toHaveBeenCalledWith(dbError, false);
  });

  test("should extract JWT from lowercase authorization header", () => {
    const token = jwt.sign({ userId: "user-123" }, process.env.JWT_SECRET);

    const mockReq = {
      headers: {
        // lowercase 'bearer'
        authorization: `bearer ${token}`,
      },
    };

    const extracted = jwtStrategy._jwtFromRequest(mockReq);
    expect(extracted).toBe(token);
  });

  test("should return null when no Authorization header present", () => {
    const mockReq = { headers: {} };
    const extracted = jwtStrategy._jwtFromRequest(mockReq);
    expect(extracted).toBeNull();
  });

  test("should return null when Authorization header malformed", () => {
    const mockReq = {
      headers: {
        authorization: "NotBearer token",
      },
    };

    const extracted = jwtStrategy._jwtFromRequest(mockReq);
    expect(extracted).toBeNull();
  });
});
