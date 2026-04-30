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
  /**
   * Comma-separated list of literal allowed origins (e.g.
   * `https://project-yhbyn.vercel.app,http://localhost:3000`).
   * Combined with `corsOriginPattern` below — a request's `Origin`
   * header is allowed if it matches any literal here OR the pattern.
   */
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  /**
   * Optional regex (as a string) for dynamic origins like Vercel
   * preview URLs that change per deployment. Example for this project:
   *   ^https://travel-itinerary-maker-[a-z0-9]+-justmarks-projects\.vercel\.app$
   * Unset means "no pattern matching"; literal `corsOrigin` still applies.
   */
  corsOriginPattern: process.env.CORS_ORIGIN_PATTERN || "",
};
