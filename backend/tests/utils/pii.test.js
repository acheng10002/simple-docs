const { hashForLog, maskEmail } = require("../../src/utils/pii");

describe("PII utility functions", () => {
  describe("hashForLog", () => {
    test("should return null for null input", () => {
      expect(hashForLog(null)).toBeNull();
    });

    test("should return null for undefined input", () => {
      expect(hashForLog(undefined)).toBeNull();
    });

    test("should return null for empty string", () => {
      expect(hashForLog("")).toBeNull();
    });

    test("should return 12-character hash for valid input", () => {
      const result = hashForLog("user@example.com");
      expect(result).toHaveLength(12);
      expect(result).toMatch(/^[a-f0-9]{12}$/);
    });

    test("should return consistent hash for same input", () => {
      const input = "test@example.com";
      const hash1 = hashForLog(input);
      const hash2 = hashForLog(input);
      expect(hash1).toBe(hash2);
    });

    test("should return different hashes for different inputs", () => {
      const hash1 = hashForLog("user1@example.com");
      const hash2 = hashForLog("user2@example.com");
      expect(hash1).not.toBe(hash2);
    });

    test("should handle IP addresses", () => {
      const result = hashForLog("192.168.1.1");
      expect(result).toHaveLength(12);
      expect(result).toMatch(/^[a-f0-9]{12}$/);
    });

    test("should handle numeric input by converting to string", () => {
      const result = hashForLog(12345);
      expect(result).toHaveLength(12);
      expect(result).toMatch(/^[a-f0-9]{12}$/);
    });

    test("should handle special characters and unicode", () => {
      const result = hashForLog("user+tag@example.com");
      expect(result).toHaveLength(12);
      expect(result).toMatch(/^[a-f0-9]{12}$/);

      const unicodeResult = hashForLog("用户@example.com");
      expect(unicodeResult).toHaveLength(12);
      expect(unicodeResult).toMatch(/^[a-f0-9]{12}$/);
    });

    test("should produce different hash for similar inputs", () => {
      const hash1 = hashForLog("test");
      const hash2 = hashForLog("Test");
      const hash3 = hashForLog("test ");
      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe("maskEmail", () => {
    test("should return [invalid] for null input", () => {
      expect(maskEmail(null)).toBe("[invalid]");
    });

    test("should return [invalid] for undefined input", () => {
      expect(maskEmail(undefined)).toBe("[invalid]");
    });

    test("should return [invalid] for empty string", () => {
      expect(maskEmail("")).toBe("[invalid]");
    });

    test("should return [invalid] for string without @ symbol", () => {
      expect(maskEmail("notanemail")).toBe("[invalid]");
    });

    test("should mask local part and preserve domain", () => {
      expect(maskEmail("user@example.com")).toBe("***@example.com");
    });

    test("should handle complex local parts", () => {
      expect(maskEmail("john.doe+tag@example.com")).toBe("***@example.com");
    });

    test("should handle subdomains", () => {
      expect(maskEmail("user@mail.example.com")).toBe("***@mail.example.com");
    });

    test("should handle short local parts", () => {
      expect(maskEmail("a@example.com")).toBe("***@example.com");
    });

    test("should handle emails with multiple @ symbols (uses first split)", () => {
      // Edge case: split creates array, destructuring takes second element only
      const result = maskEmail("user@weird@example.com");
      expect(result).toBe("***@weird");
    });

    test("should handle email with only @ symbol", () => {
      expect(maskEmail("@")).toBe("***@");
    });

    test("should handle international domains", () => {
      expect(maskEmail("user@例え.jp")).toBe("***@例え.jp");
    });
  });
});
