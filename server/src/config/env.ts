export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/auth/google/callback",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  },
  sentry: {
    // Unset in dev/CI; set in production to opt the server into error
    // reporting. See services/monitoring.ts for the init gate.
    dsn: process.env.SENTRY_DSN || "",
  },
  /**
   * Upstash Redis REST credentials — when both are set, TokenStore and
   * ShareRegistry persist entries via Redis so they survive process
   * restarts. Either var unset (or empty) is treated as "Redis disabled"
   * so dev / tests transparently fall back to the in-memory paths.
   *
   * Source: Upstash Console → Databases → REST API. These are
   * per-database credentials, not the account / management API key.
   */
  redis: {
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  },
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
};
