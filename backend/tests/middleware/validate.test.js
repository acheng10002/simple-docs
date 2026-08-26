const { z } = require("zod");
const { validate, formatZodError, formatZodDetails } = require("../../src/middleware/validate");

function createMockReqRes(overrides = {}) {
  const req = {
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("validate middleware", () => {
  describe("params validation", () => {
    it("should pass valid params and call next", async () => {
      const schema = z.object({ id: z.string().min(1) });
      const middleware = validate({ params: schema });
      const { req, res, next } = createMockReqRes({ params: { id: "abc123" } });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.params).toEqual({ id: "abc123" });
    });

    it("should return 400 for invalid params", async () => {
      const schema = z.object({ id: z.string().min(1) });
      const middleware = validate({ params: schema });
      const { req, res, next } = createMockReqRes({ params: { id: "" } });

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
          }),
        })
      );
    });
  });

  describe("query validation", () => {
    it("should pass valid query and call next", async () => {
      const schema = z.object({ page: z.coerce.number().default(1) });
      const middleware = validate({ query: schema });
      const { req, res, next } = createMockReqRes({ query: { page: "2" } });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query).toEqual({ page: 2 });
    });

    it("should apply defaults for missing query params", async () => {
      const schema = z.object({ page: z.coerce.number().default(1) });
      const middleware = validate({ query: schema });
      const { req, res, next } = createMockReqRes({ query: {} });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query).toEqual({ page: 1 });
    });
  });

  describe("body validation", () => {
    it("should pass valid body and call next", async () => {
      const schema = z.object({ name: z.string(), email: z.string().email() });
      const middleware = validate({ body: schema });
      const { req, res, next } = createMockReqRes({
        body: { name: "John", email: "john@example.com" },
      });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("should return 400 for invalid body", async () => {
      const schema = z.object({ email: z.string().email() });
      const middleware = validate({ body: schema });
      const { req, res, next } = createMockReqRes({ body: { email: "not-an-email" } });

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("multiple schemas", () => {
    it("should validate params, query, and body together", async () => {
      const middleware = validate({
        params: z.object({ id: z.string() }),
        query: z.object({ format: z.enum(["json", "xml"]) }),
        body: z.object({ data: z.record(z.string(), z.unknown()) }),
      });
      const { req, res, next } = createMockReqRes({
        params: { id: "123" },
        query: { format: "json" },
        body: { data: { key: "value" } },
      });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("should fail on first invalid source (params before body)", async () => {
      const middleware = validate({
        params: z.object({ id: z.string().regex(/^c[a-z0-9]{24}$/) }),
        body: z.object({ name: z.string() }),
      });
      const { req, res, next } = createMockReqRes({
        params: { id: "invalid" },
        body: { name: "valid" },
      });

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("unexpected errors", () => {
    it("should pass non-Zod errors to next", async () => {
      const middleware = validate({
        body: z.object({}).transform(() => { throw new Error("Unexpected"); }),
      });
      const { req, res, next } = createMockReqRes({ body: {} });

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});

describe("formatZodError", () => {
  it("should return first issue message", () => {
    const error = new z.ZodError([
      { path: ["email"], message: "Invalid email", code: "invalid_string", validation: "email" },
    ]);
    expect(formatZodError(error)).toBe("Invalid email");
  });

  it("should return 'Validation failed' for empty issues", () => {
    const error = new z.ZodError([]);
    expect(formatZodError(error)).toBe("Validation failed");
  });
});

describe("formatZodDetails", () => {
  it("should format issues into field/message/code objects", () => {
    const error = new z.ZodError([
      { path: ["email"], message: "Invalid email", code: "invalid_string", validation: "email" },
      { path: ["password"], message: "Too short", code: "too_small", minimum: 8, type: "string", inclusive: true, exact: false },
    ]);

    const details = formatZodDetails(error);

    expect(details).toEqual([
      { field: "email", message: "Invalid email", code: "invalid_string" },
      { field: "password", message: "Too short", code: "too_small" },
    ]);
  });

  it("should use 'root' for path-less issues", () => {
    const error = new z.ZodError([
      { path: [], message: "Invalid input", code: "custom" },
    ]);

    const details = formatZodDetails(error);
    expect(details[0].field).toBe("root");
  });

  it("should join nested paths with dots", () => {
    const error = new z.ZodError([
      { path: ["data", "nested", "field"], message: "Required", code: "invalid_type", expected: "string", received: "undefined" },
    ]);

    const details = formatZodDetails(error);
    expect(details[0].field).toBe("data.nested.field");
  });
});
