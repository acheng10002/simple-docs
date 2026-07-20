// Set a dummy URL before requiring the module — parseConnectionUrl runs at
// module load to build dbConfig from DIRECT_URL / DATABASE_URL.
process.env.DIRECT_URL = "postgresql://boot:boot@localhost:5432/boot?sslmode=disable";

const { parseConnectionUrl } = require("../../src/middleware/rate-limiter");

describe("parseConnectionUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_CA_CERT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("parses basic connection fields from URL", () => {
    const config = parseConnectionUrl(
      "postgresql://myuser:mypass@db.example.com:6543/mydb"
    );

    expect(config.user).toBe("myuser");
    expect(config.password).toBe("mypass");
    expect(config.host).toBe("db.example.com");
    expect(config.port).toBe(6543);
    expect(config.database).toBe("mydb");
  });

  it("defaults port to 5432 when not specified", () => {
    const config = parseConnectionUrl(
      "postgresql://user:pass@host/db"
    );

    expect(config.port).toBe(5432);
  });

  it("disables SSL when sslmode=disable", () => {
    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db?sslmode=disable"
    );

    expect(config.ssl).toBe(false);
  });

  it("defaults to no SSL in non-production when sslmode is not set", () => {
    process.env.NODE_ENV = "development";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db"
    );

    expect(config.ssl).toBe(false);
  });

  it("defaults to no SSL in test when sslmode is not set", () => {
    process.env.NODE_ENV = "test";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db"
    );

    expect(config.ssl).toBe(false);
  });

  it("enables SSL with rejectUnauthorized: true in production when sslmode is not set", () => {
    process.env.NODE_ENV = "production";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db"
    );

    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("enables SSL when sslmode is explicitly set to a non-disable value", () => {
    process.env.NODE_ENV = "development";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db?sslmode=require"
    );

    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("includes CA cert when DATABASE_CA_CERT is set", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db"
    );

    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    });
  });

  it("does not include CA cert when SSL is disabled even if DATABASE_CA_CERT is set", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";

    const config = parseConnectionUrl(
      "postgresql://user:pass@host:5432/db?sslmode=disable"
    );

    expect(config.ssl).toBe(false);
  });
});
