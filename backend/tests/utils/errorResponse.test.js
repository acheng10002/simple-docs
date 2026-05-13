const { ErrorCodes, buildError, sendError, errorResponse } = require("../../src/utils/errorResponse");

// Mock Express response object
function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe("errorResponse utility", () => {
  describe("buildError", () => {
    test("builds basic error object", () => {
      const result = buildError("TEST_CODE", "Test message");
      expect(result).toEqual({
        error: { code: "TEST_CODE", message: "Test message" },
      });
    });

    test("includes details when provided", () => {
      const result = buildError("TEST", "msg", { details: { field: "name" } });
      expect(result.error.details).toEqual({ field: "name" });
    });

    test("includes retryAfter when provided", () => {
      const result = buildError("TEST", "msg", { retryAfter: 30 });
      expect(result.error.retryAfter).toBe(30);
    });

    test("omits details and retryAfter when not provided", () => {
      const result = buildError("TEST", "msg");
      expect(result.error).not.toHaveProperty("details");
      expect(result.error).not.toHaveProperty("retryAfter");
    });
  });

  describe("sendError", () => {
    test("sets status code and sends JSON", () => {
      const res = mockRes();
      sendError(res, 400, "BAD", "Bad request");
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe("BAD");
      expect(res.body.error.message).toBe("Bad request");
    });
  });

  describe("convenience methods", () => {
    test("badRequest sends 400", () => {
      const res = mockRes();
      errorResponse.badRequest(res, "Invalid input");
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    test("badRequest with custom code and options", () => {
      const res = mockRes();
      errorResponse.badRequest(res, "Missing", ErrorCodes.MISSING_FIELD, { details: ["name"] });
      expect(res.body.error.code).toBe(ErrorCodes.MISSING_FIELD);
      expect(res.body.error.details).toEqual(["name"]);
    });

    test("unauthorized sends 401", () => {
      const res = mockRes();
      errorResponse.unauthorized(res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    });

    test("forbidden sends 403", () => {
      const res = mockRes();
      errorResponse.forbidden(res, "Not allowed");
      expect(res.statusCode).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    test("notFound sends 404", () => {
      const res = mockRes();
      errorResponse.notFound(res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    test("conflict sends 409", () => {
      const res = mockRes();
      errorResponse.conflict(res, "Already exists");
      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });

    test("payloadTooLarge sends 413", () => {
      const res = mockRes();
      errorResponse.payloadTooLarge(res, "File too big");
      expect(res.statusCode).toBe(413);
      expect(res.body.error.code).toBe(ErrorCodes.PAYLOAD_TOO_LARGE);
    });

    test("unsupportedMediaType sends 415", () => {
      const res = mockRes();
      errorResponse.unsupportedMediaType(res, "Bad format");
      expect(res.statusCode).toBe(415);
      expect(res.body.error.code).toBe(ErrorCodes.UNSUPPORTED_MEDIA_TYPE);
    });

    test("unprocessable sends 422", () => {
      const res = mockRes();
      errorResponse.unprocessable(res, "Parse error", ErrorCodes.TEMPLATE_PARSE_ERROR, { details: ["bad tag"] });
      expect(res.statusCode).toBe(422);
      expect(res.body.error.details).toEqual(["bad tag"]);
    });

    test("rateLimited sends 429 with retryAfter", () => {
      const res = mockRes();
      errorResponse.rateLimited(res, "Slow down", 120);
      expect(res.statusCode).toBe(429);
      expect(res.body.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(res.body.error.retryAfter).toBe(120);
    });

    test("rateLimited uses defaults", () => {
      const res = mockRes();
      errorResponse.rateLimited(res);
      expect(res.statusCode).toBe(429);
      expect(res.body.error.retryAfter).toBe(60);
    });

    test("internal sends 500", () => {
      const res = mockRes();
      errorResponse.internal(res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    });

    test("serviceUnavailable sends 503", () => {
      const res = mockRes();
      errorResponse.serviceUnavailable(res, "Down for maintenance");
      expect(res.statusCode).toBe(503);
      expect(res.body.error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
    });

    test("timeout sends 504", () => {
      const res = mockRes();
      errorResponse.timeout(res);
      expect(res.statusCode).toBe(504);
      expect(res.body.error.code).toBe(ErrorCodes.TIMEOUT);
    });
  });
});
