export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  },
  /**
   * Separate OAuth client used exclusively for Gmail's restricted
   * `gmail.readonly` scope. Keeping Gmail off the primary client lets
   * the primary client clear standard verification (Drive + Calendar
   * are sensitive but not restricted) without dragging the whole app
   * through Google's CASA security assessment. Users who opt into
   * email scanning consent to this client separately; it can stay in
   * "Testing" mode (≤100 manually-added test users) until the project
   * is ready to fund production verification.
   *
   * Either var unset (or empty) means "Gmail integration disabled" —
   * the auth route returns 503 and the email-scan UI gates on the
   * presence of a Gmail link.
   */
  googleGmail: {
    clientId: process.env.GOOGLE_GMAIL_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_GMAIL_CLIENT_SECRET || "",
  },
  /**
   * Microsoft (Azure AD) OAuth client used for sign-in AND for
   * Microsoft Graph mail + calendar access. Unlike Google, Microsoft
   * doesn't gate mail/calendar scopes behind a CASA-style assessment
   * — `Mail.Read` and `Calendars.ReadWrite` are standard delegated
   * permissions requiring only user consent — so one client serves
   * every capability.
   *
   * `tenantId` controls the issuer:
   *   - `common` (default) — multi-tenant: any work / school /
   *     personal Microsoft account can sign in.
   *   - `consumers` — personal Microsoft accounts only.
   *   - `organizations` — work/school accounts only (no personal).
   *   - `<tenant-guid>` — single-tenant: only users in that
   *     specific Azure AD directory.
   *
   * Any var unset (or empty) means "Microsoft integration disabled"
   * — Phase 4b-2's token refresh helper bails early when these
   * aren't set.
   */
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
    tenantId: process.env.MICROSOFT_TENANT_ID || "common",
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
   *   ^https://itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app$
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
   * Phase 1 of the Drive→Supabase migration. Controls which
   * StorageProvider per-user requests resolve to.
   *
   *   STORAGE_BACKEND
   *     `drive` — every user reads/writes their own Drive folder,
   *       except those listed in STORAGE_POSTGRES_USERS who are routed
   *       to Postgres for dogfooding. The production default.
   *     `postgres` — every user is on Postgres. Requires DATABASE_URL.
   *     `memory` — dev/test only.
   *     unset — `index.ts` defaults to `drive` in production
   *       (NODE_ENV=production) and `memory` in dev. Set explicitly to
   *       opt into a different mode for local dev (e.g. `drive` for
   *       testing the per-user dogfood list against Neon).
   *
   *   STORAGE_POSTGRES_USERS
   *     Comma-separated list of user IDs (Google `sub` strings)
   *     that should use Postgres even when the resolved backend is
   *     `drive`. Empty list means nobody overrides. Only consulted
   *     when backend is `drive` AND DATABASE_URL is set.
   *
   *   DATABASE_URL
   *     Postgres connection string. Required when storage involves
   *     Postgres (mode=postgres OR a non-empty postgresUsers list).
   */
  storage: {
    // `undefined` when unset so `index.ts` can apply the env-aware
    // default (postgres in prod, memory in dev). The pre-Phase-6
    // `drive` backend is gone — only `postgres` and `memory` are
    // valid values today.
    backend:
      process.env.STORAGE_BACKEND === "postgres" ||
      process.env.STORAGE_BACKEND === "memory"
        ? (process.env.STORAGE_BACKEND as "postgres" | "memory")
        : undefined,
    databaseUrl: process.env.DATABASE_URL || "",
  },
  /**
   * Phase 3 of the Drive→Supabase migration: Supabase Auth as the
   * identity layer.
   *
   *   SUPABASE_URL — project URL, e.g. https://abcxyz.supabase.co.
   *     When set, `requireAuth` accepts Supabase JWTs in addition to
   *     legacy Google access tokens. Server only needs the URL; the
   *     JWKS endpoint is derived from it and the JWT signature key
   *     comes from there. When unset, `requireAuth` validates Google
   *     tokens only (legacy behaviour, what every pre-phase-3 user
   *     sends).
   */
  supabase: {
    url: process.env.SUPABASE_URL || "",
    /**
     * Service-role key for the Supabase Auth admin API. Distinct from
     * the anon key shipped to the browser — this one bypasses RLS and
     * grants admin access to GoTrue.
     *
     * Currently used only by the account-deletion endpoint
     * (`DELETE /api/v1/account`) to wipe the Supabase Auth row after
     * Postgres + provider tokens are cleaned up. Unset means the
     * endpoint still returns 204 and wipes everything else; the Auth
     * row stays behind for an operator to remove manually. Never
     * expose this key to a browser bundle.
     */
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  },
};
