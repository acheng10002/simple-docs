/* SENTRY ERROR TRACKING CONFIGURATION
captures and reports errors in production */
const Sentry = require("@sentry/node");

function initSentry() {
  // only initializes Sentry if DSN is provided
  if (!process.env.SENTRY_DSN) {
    console.warn("SENTRY_DSN not set - error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",

    // performance monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // TEMPORARY - Express integration for request tracking
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],

    // TEMPORARY
    enabled: true,

    // set release version for tracking
    release:
      process.env.NODE_ENV === "production"
        ? process.env.npm_package_version || "1.0.0"
        : `dev-${Date.now()}`,
  });

  console.log("Sentry error tracking initialized");
}

module.exports = { initSentry, Sentry };
