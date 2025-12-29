/* STRUCTURED LOGGING CONFIGURATION 
centralized Pino logger setup with environment-aware formatting */
const pino = require("pino");

// determines if we're in dev or prod
const isDevelopment = process.env.NODE_ENV != "production";

// creates logger with environment-specific configuration
const logger = pino({
  // log level from environment or default to 'info'
  level: process.env.LOG_LEVEL || "info",

  // dev: pretty-print to console
  // prod: JSON output for long aggregators
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,

  // base fields included in every log
  base: {
    env: process.env.NODE_ENV || "development",
    // includes hostname and pid in prod for distributed systems
    ...(isDevelopment ? {} : { hostname: require("os").hostname() }),
  },

  // serializes errors properly
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // redacts sensitive fields from logs
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "secret",
      "token",
    ],
    remove: true,
  },
});

module.exports = logger;
