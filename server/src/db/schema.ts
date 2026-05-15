/**
 * Drizzle schema for itinly's domain tables. Phase 1 of the
 * Drive→Supabase migration replaces the phase 0 scaffold with the real
 * shape: enough normalization to enable cross-trip queries in future
 * phases (e.g. "all flights in the next month"), but pragmatic about
 * not pre-splitting tables we never read independently.
 *
 * Normalized into their own tables:
 *   trips, segments, todos, trip_history, share_rules,
 *   processed_emails, user_settings
 *
 * Kept inline on `trips` as jsonb (small, only read with the parent):
 *   day_cities — `{ "YYYY-MM-DD": "City" }` map for per-day city overrides
 *   shares     — `TripShare[]` per-trip share tokens. Phase 2 moves
 *                these to a centralised `trip_shares` table when sharing
 *                state leaves Redis.
 *
 * Phase 1 omits (deferred to phase 2 or 3):
 *   trip_shares, push_subscriptions, share_activity — phase 2 (off Redis)
 *   connections, user_tokens — phase 3 (Supabase Auth)
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  date,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// `trips` carries everything queried in the list view (so `listTrips`
// can stay a single scalar SELECT) plus two small jsonb blobs for
// data we never read independently of the trip.
export const trips = pgTable(
  "trips",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull(),
    calendarId: text("calendar_id"),
    schemaVersion: integer("schema_version").notNull().default(2),
    // date → city map. Empty/missing keys fall back to a derivation
    // (last-known city, segment city, etc.) the storage layer applies
    // on read. Keeping this as a small jsonb avoids a `trip_days`
    // table whose only stateful column would be `city`.
    dayCities: jsonb("day_cities")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // `TripShare[]` — per-trip share tokens. Phase 2 moves to a real
    // `trip_shares` table; for phase 1 we preserve the existing shape
    // so SupabaseStorage can be wired in without touching Redis state.
    shares: jsonb("shares")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite index that backs `listTrips` (user_id filter, start_date
    // sort). Postgres can scan this backward for DESC ordering so we
    // don't need a separate DESC index.
    index("trips_user_start_date_idx").on(t.userId, t.startDate),
  ],
);

// `segments` is normalized because phase 2+ will run cross-trip queries
// ("all flights with departure in the next 7 days", trip-list cards
// showing the next upcoming segment, etc.). Common scalar fields are
// columns; variant-specific shape (airline, flightNumber, hotel
// breakfast flag, cruise ports of call, …) sits in `data` jsonb. Saves
// having 30+ mostly-NULL columns.
export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayDate: date("day_date").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    type: text("type").notNull(),
    title: text("title").notNull(),
    startTime: text("start_time"), // HH:MM wall-clock local; see CLAUDE.md
    endTime: text("end_time"),
    endDate: date("end_date"), // multi-day: hotel check-out, car drop-off
    city: text("city"),
    source: text("source").notNull(),
    sourceEmailId: text("source_email_id"),
    needsReview: boolean("needs_review").notNull().default(false),
    calendarEventId: text("calendar_event_id"),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Loads "the segments on this day" — the order we hand back to the
    // UI in `TripDay.segments`. Also serves the timeline view, which
    // walks segments across a trip in date order.
    index("segments_trip_day_order_idx").on(t.tripId, t.dayDate, t.sortOrder),
  ],
);

export const todos = pgTable(
  "todos",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    category: text("category"),
    details: text("details"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("todos_trip_order_idx").on(t.tripId, t.sortOrder)],
);

// Append-only audit log. The storage layer trims to the most recent
// 500 entries per trip on write (matching the in-memory cap noted in
// `Trip.history`'s comment). Kind is the discriminator on
// `TripHistoryKind`; details / entityId are display-only.
export const tripHistory = pgTable(
  "trip_history",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name"),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    details: text("details"),
    entityId: text("entity_id"),
  },
  (t) => [
    // Display always reads newest-first; backward scan on this index.
    index("trip_history_trip_ts_idx").on(t.tripId, t.ts),
  ],
);

// Owner-scoped auto-share rules. One row = "every trip I have/create
// should be shared with X with these settings". `TripShare` rows (in
// `trips.shares` for phase 1) spawned by a rule carry an
// `originRuleId` referencing this table — that's the cascade key for
// rule-edit / rule-delete in the route handlers.
export const shareRules = pgTable(
  "share_rules",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerEmail: text("owner_email"),
    sharedWithEmail: text("shared_with_email").notNull(),
    permission: text("permission").notNull(),
    showCosts: boolean("show_costs").notNull().default(true),
    showTodos: boolean("show_todos").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("share_rules_owner_created_idx").on(t.ownerUserId, t.createdAt),
    // One rule per (owner, recipient) — matches the type-level comment.
    uniqueIndex("share_rules_owner_recipient_uniq").on(
      t.ownerUserId,
      t.sharedWithEmail,
    ),
  ],
);

// Email-scan history. Schema is future-proofed for phase 4
// (`provider` + `account_email` columns) so multi-mailbox /
// Microsoft Graph users don't need a migration when they land.
// `raw` holds the full provider message JSON so the parser can be
// re-run offline as it improves — chosen over "normalized fields only"
// during phase 1 planning specifically for reparseability.
export const processedEmails = pgTable(
  "processed_emails",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull().default("google"),
    accountEmail: text("account_email").notNull().default(""),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id"),
    subject: text("subject"),
    fromAddress: text("from_address"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    parsedType: text("parsed_type"),
    segmentId: text("segment_id"),
    tripId: text("trip_id").references(() => trips.id, {
      onDelete: "set null",
    }),
    parseStatus: text("parse_status").notNull(),
    parseError: text("parse_error"),
    parsedResult: jsonb("parsed_result").$type<unknown>(),
    raw: jsonb("raw").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // De-dup key across providers / accounts. Two Gmail accounts can
    // legitimately surface the same `messageId` (provider-scoped),
    // hence the composite uniqueness.
    uniqueIndex("processed_emails_msg_uniq").on(
      t.userId,
      t.provider,
      t.accountEmail,
      t.messageId,
    ),
    index("processed_emails_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  gmailLabelFilter: text("gmail_label_filter"),
  emailScanIntervalMinutes: integer("email_scan_interval_minutes")
    .notNull()
    .default(1440),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 2: durable replacement for the in-memory ShareRegistry's
// Redis-backed hash. One row per share token issued. Maps the token
// to the underlying trip + owner so the public `/shared/:token` route
// can resolve which user's storage holds the trip, and indexes by
// `shared_with_email` so the contributor flow can list "every trip
// shared with me" in one query.
//
// Distinct from `trips.shares` jsonb (added in phase 1) which is the
// trip-side view — same data, different access pattern. Kept in sync
// by `applyShareToTrip` on writes; future cleanup may unify these.
//
// Cascade-delete with the trip mirrors the Phase 1 segments / todos
// FK behaviour — removing a trip removes its share tokens
// automatically.
export const tripShares = pgTable(
  "trip_shares",
  {
    shareToken: text("share_token").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    ownerEmail: text("owner_email"),
    // Always lower-cased on insert. Indexed because lookupByEmail
    // fires on every authed `listTrips` call to find contributor-side
    // trips.
    sharedWithEmail: text("shared_with_email"),
    permission: text("permission").notNull(), // 'view' | 'edit'
    showCosts: boolean("show_costs").notNull().default(true),
    showTodos: boolean("show_todos").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("trip_shares_email_idx").on(t.sharedWithEmail),
    index("trip_shares_trip_idx").on(t.tripId),
  ],
);

// Phase 2: durable replacement for PushSubscriptionStore's Redis hash.
// One row per (browser, user) push endpoint — same browser registering
// twice upserts on `endpoint` (the PK) rather than creating duplicates.
// `last_used_at` is reserved for a future inactivity-expiry policy
// (open decision in the migration plan); phase 2 doesn't read or
// update it yet.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id").notNull(),
    // Always lower-cased on insert. Indexed because the share-creation
    // flow looks up "every device the invited recipient is signed in
    // on" by email.
    email: text("email").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    index("push_subscriptions_user_idx").on(t.userId),
    index("push_subscriptions_email_idx").on(t.email),
  ],
);

// Phase 3 of the Drive→Supabase migration. Per-user OAuth connections
// to external providers (Google, Microsoft). One row per
// (user, provider, capability, account_email) so a user can have:
//   - Both Google + Microsoft identity connections (account-merge flow)
//   - Multiple Gmail accounts (gmail-personal + gmail-work)
//   - Identity vs email vs calendar treated as separate "capabilities"
//     even when granted by the same OAuth round (Phase 4 splits them
//     out for clearer "is gmail connected?" semantics).
//
// Tokens are AES-256-GCM encrypted at rest via the same
// `token-crypto.ts` helpers TokenStore uses. Format: `v1:nonce-hex:
// ciphertext-hex:tag-hex`. Plain text columns so the format stays
// debuggable via `psql` (you can see the version prefix); the
// ciphertext itself is binary entropy.
//
// `status` lifecycle: `active` (default) → `revoked` (user revoked at
// provider or via DELETE /connections/:id) → garbage-collected later.
// Soft-delete rather than hard so audit trails / re-auth UX know an
// expired connection used to exist.
// Phase: auto email-scan scheduler. One row per (user, provider,
// labelFilter, frequency) — a user can have multiple schedules each
// targeting a different inbox / folder, and the scheduler treats each
// independently. `next_run_at` is the trigger column: the cron-tick
// endpoint selects rows where `enabled AND next_run_at <= now()`,
// runs the underlying email scan, then bumps `last_run_at` and
// `next_run_at` (`now() + frequency`).
//
// Indexes:
//  - `email_scan_schedules_user_idx` for the settings UI's
//    `listForUser` query.
//  - `email_scan_schedules_due_idx` is the cron-tick hot path —
//    composite on `(enabled, next_run_at)` so Postgres can do a
//    single index scan and skip disabled rows.
//
// RLS: Both this table and `email_scan_runs` have row-level security
// enabled in migration 0004 with an owner-only policy
// (`auth.uid()::text = user_id`). The server connects as `postgres`
// which has BYPASSRLS, so server reads / writes are unaffected; the
// policies exist to gate the Supabase-managed PostgREST endpoint
// against the browser-shipped anon key. **Any new user-scoped table
// must do the same** — ideally enable RLS in the same migration
// that creates the table. See `drizzle/0004_email_scan_rls.sql` for
// the pattern.
export const emailScanSchedules = pgTable(
  "email_scan_schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(), // 'google' | 'microsoft'
    labelFilter: text("label_filter"), // gmail label id or outlook folder id
    labelName: text("label_name"), // cached human-readable label for the UI
    frequency: text("frequency").notNull(), // 'daily' | 'weekly' | 'monthly'
    enabled: boolean("enabled").notNull().default(true),
    // When true, the schedule scans descendants of `label_filter` too
    // (e.g. "Travel" → also "Travel/Hotels", "Travel/Flights/Confirmed").
    // The executor expands the filter at run time by walking the
    // connector's `listLabels()` and finding entries with name prefix
    // `<parent>/`. No effect when `label_filter` is null — the scan
    // already covers everything in that case.
    includeSublabels: boolean("include_sublabels").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_scan_schedules_user_idx").on(t.userId),
    index("email_scan_schedules_due_idx").on(t.enabled, t.nextRunAt),
  ],
);

// One row per execution of a schedule. Capped to the last 50 per
// schedule at write time so the settings UI's "Recent runs" panel
// stays cheap and table growth is bounded. Cascade-delete with the
// parent schedule.
export const emailScanRuns = pgTable(
  "email_scan_runs",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => emailScanSchedules.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(), // 'running' | 'succeeded' | 'failed'
    scannedCount: integer("scanned_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (t) => [
    // Newest-run-first within a schedule is the only access pattern.
    index("email_scan_runs_schedule_idx").on(t.scheduleId, t.startedAt),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(), // 'google' | 'microsoft'
    capability: text("capability").notNull(), // 'identity' | 'email' | 'calendar'
    accountEmail: text("account_email").notNull(), // lower-cased on insert
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessTokenEncrypted: text("access_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per (user, provider, capability, email) — re-connecting
    // the same Gmail account upserts the tokens rather than creating
    // duplicates.
    uniqueIndex("connections_user_provider_capability_email_uniq").on(
      t.userId,
      t.provider,
      t.capability,
      t.accountEmail,
    ),
    // listForUser hits this on every authed page-load that needs to
    // know which providers a user has connected.
    index("connections_user_idx").on(t.userId),
  ],
);
