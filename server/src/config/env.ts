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
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
};
