export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
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
   * 32-byte encryption key (hex-encoded, 64 chars) for at-rest
   * encryption of refresh tokens written to Redis. When unset, refresh
   * tokens persist as plaintext (legacy behaviour — fine for dev /
   * tests, not recommended for production). Generate one with
   * `openssl rand -hex 32`. See `services/token-crypto.ts` for the
   * format and `docs/redis-persistence.md` for the rotation story.
   */
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
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
  /**
   * VAPID keys for Web Push (RFC 8292). Generate once with
   * `npx web-push generate-vapid-keys` and persist both halves; the
   * public half is also exposed to the browser as
   * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the subscription handshake. The
   * subject is a `mailto:` URL push providers use to contact the
   * application owner if a push goes wrong. Either key unset disables
   * push delivery — callers degrade to a no-op so dev / tests run
   * without keys configured.
   */
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:hello@itinly.app",
  },
  /**
   * Outbound mailer used by POST /api/v1/emails/report to forward
   * user-submitted parse-failure reports to the operator inbox. When
   * `host` is unset the route degrades to logging + Sentry capture so
   * dev / CI don't need SMTP credentials.
   */
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "noreply@itinly.app",
  },
  /**
   * Destination mailbox for parse-failure reports. The CLAUDE.md /
   * README documents this as `emailerror@itinly.app`; override per
   * environment when needed.
   */
  emailReportTo: process.env.EMAIL_REPORT_TO || "emailerror@itinly.app",
};
