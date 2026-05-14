/**
 * Postgres-backed `StorageProvider` impl. Phase 1 of the
 * Drive→Supabase migration: a third backend alongside `InMemoryStorage`
 * and `DriveStorage`, satisfying the same contract test suite. Wired
 * into `app.ts` behind a per-user feature flag in commit 4.
 *
 * Per-user scoping: this class is constructed with a `userId` and
 * filters every query by it. Mirrors `DriveStorage`'s "one instance per
 * user" pattern, so the routing layer (`resolveStorage(req)`) can swap
 * backends without changing route handlers.
 *
 * Reads use a 4-query batch strategy (one query per child table for
 * the trip set, grouped in JS). Writes wrap in a single transaction
 * so partial failure doesn't leave inconsistent state. Both choices
 * are documented inline at their call sites.
 *
 * Row-shape note: nested `Trip.days[].segments` are denormalised to a
 * flat `segments` table indexed by `(trip_id, day_date, sort_order)`.
 * Days themselves are derived from `start_date..end_date` plus the
 * trip's `day_cities` jsonb. `dayOfWeek` is computed from the date.
 */
import { eq, and, inArray, desc, asc } from "drizzle-orm";
import {
  CURRENT_TRIP_SCHEMA_VERSION,
  type Trip,
  type TripDay,
  type TripShare,
  type TripShareRule,
  type Segment,
  type Todo,
  type TripHistoryEntry,
  type UserSettings,
} from "@itinly/shared";
import type { StorageProvider } from "./storage";
import type { ProcessedEmail } from "./processed-email";
import type { Db } from "../db/client";
import {
  trips as tripsTable,
  segments as segmentsTable,
  todos as todosTable,
  tripHistory as historyTable,
  shareRules as shareRulesTable,
  processedEmails as processedEmailsTable,
  userSettings as settingsTable,
} from "../db/schema";

const DEFAULT_SETTINGS: UserSettings = {
  emailScanIntervalMinutes: 1440,
  notificationsEnabled: true,
};

const DAY_OF_WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface SupabaseStorageOptions {
  db: Db;
  /** Owner of every row this instance reads or writes. */
  userId: string;
}

export class SupabaseStorage implements StorageProvider {
  private db: Db;
  private userId: string;

  constructor(opts: SupabaseStorageOptions) {
    this.db = opts.db;
    this.userId = opts.userId;
  }

  // ---- trips ----

  async listTrips(): Promise<Trip[]> {
    // Four queries total regardless of trip count: one for the trip
    // rows, one each for segments/todos/history filtered by
    // `trip_id IN (...)`. Then we group in JS. This keeps `listTrips`
    // O(1) round-trips instead of O(N) per-trip lookups, which matters
    // once a user has tens of trips and the API↔DB hop adds up.
    const tripRows = await this.db
      .select()
      .from(tripsTable)
      .where(eq(tripsTable.userId, this.userId))
      .orderBy(desc(tripsTable.startDate));

    if (tripRows.length === 0) return [];
    const ids = tripRows.map((t) => t.id);

    const [segmentRows, todoRows, historyRows] = await Promise.all([
      this.db
        .select()
        .from(segmentsTable)
        .where(inArray(segmentsTable.tripId, ids))
        .orderBy(asc(segmentsTable.dayDate), asc(segmentsTable.sortOrder)),
      this.db
        .select()
        .from(todosTable)
        .where(inArray(todosTable.tripId, ids))
        .orderBy(asc(todosTable.sortOrder)),
      this.db
        .select()
        .from(historyTable)
        .where(inArray(historyTable.tripId, ids))
        .orderBy(asc(historyTable.ts)),
    ]);

    const segByTrip = groupBy(segmentRows, (s) => s.tripId);
    const todosByTrip = groupBy(todoRows, (t) => t.tripId);
    const historyByTrip = groupBy(historyRows, (h) => h.tripId);

    return tripRows.map((row) =>
      assembleTrip(row, {
        segments: segByTrip.get(row.id) ?? [],
        todos: todosByTrip.get(row.id) ?? [],
        history: historyByTrip.get(row.id) ?? [],
      }),
    );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const tripRows = await this.db
      .select()
      .from(tripsTable)
      .where(
        and(eq(tripsTable.id, tripId), eq(tripsTable.userId, this.userId)),
      );

    if (tripRows.length === 0) return null;

    const [segmentRows, todoRows, historyRows] = await Promise.all([
      this.db
        .select()
        .from(segmentsTable)
        .where(eq(segmentsTable.tripId, tripId))
        .orderBy(asc(segmentsTable.dayDate), asc(segmentsTable.sortOrder)),
      this.db
        .select()
        .from(todosTable)
        .where(eq(todosTable.tripId, tripId))
        .orderBy(asc(todosTable.sortOrder)),
      this.db
        .select()
        .from(historyTable)
        .where(eq(historyTable.tripId, tripId))
        .orderBy(asc(historyTable.ts)),
    ]);

    return assembleTrip(tripRows[0], {
      segments: segmentRows,
      todos: todoRows,
      history: historyRows,
    });
  }

  async saveTrip(trip: Trip): Promise<void> {
    // Day-city extraction: pull non-empty cities off the in-memory
    // `Trip.days` shape into the `day_cities` jsonb. On read, missing
    // dates fall back to "" so older callers that read `day.city`
    // without `??` don't get surprised.
    const dayCities: Record<string, string> = {};
    for (const day of trip.days) {
      if (day.city) dayCities[day.date] = day.city;
    }
    const updatedAt = new Date(trip.updatedAt);
    const createdAt = new Date(trip.createdAt);

    // Single transaction so either every child table is consistent
    // with the parent row or nothing changes. Phase 1 chooses
    // correctness over write-amplification (replace-all of segments /
    // todos / history per save). Phase 2+ can optimise to per-row
    // diffs once we have multi-second history arrays in the wild.
    await this.db.transaction(async (tx) => {
      await tx
        .insert(tripsTable)
        .values({
          id: trip.id,
          userId: this.userId,
          title: trip.title,
          startDate: trip.startDate,
          endDate: trip.endDate,
          status: trip.status,
          calendarId: trip.calendarId ?? null,
          schemaVersion: trip.schemaVersion ?? CURRENT_TRIP_SCHEMA_VERSION,
          dayCities,
          shares: trip.shares ?? [],
          createdAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: tripsTable.id,
          set: {
            title: trip.title,
            startDate: trip.startDate,
            endDate: trip.endDate,
            status: trip.status,
            calendarId: trip.calendarId ?? null,
            schemaVersion: trip.schemaVersion ?? CURRENT_TRIP_SCHEMA_VERSION,
            dayCities,
            shares: trip.shares ?? [],
            updatedAt,
          },
        });

      // Replace child rows: simpler than diffing and provably
      // correct. The transaction makes it atomic.
      await tx.delete(segmentsTable).where(eq(segmentsTable.tripId, trip.id));
      const segmentRowsToInsert = trip.days.flatMap((day) =>
        day.segments.map((seg) => segmentToRow(seg, day.date, trip.id)),
      );
      if (segmentRowsToInsert.length > 0) {
        await tx.insert(segmentsTable).values(segmentRowsToInsert);
      }

      await tx.delete(todosTable).where(eq(todosTable.tripId, trip.id));
      if (trip.todos.length > 0) {
        await tx.insert(todosTable).values(
          trip.todos.map((t) => todoToRow(t, trip.id)),
        );
      }

      await tx.delete(historyTable).where(eq(historyTable.tripId, trip.id));
      if (trip.history.length > 0) {
        await tx.insert(historyTable).values(
          trip.history.map((h) => historyToRow(h, trip.id)),
        );
      }
    });
  }

  async deleteTrip(tripId: string): Promise<boolean> {
    const result = await this.db
      .delete(tripsTable)
      .where(
        and(eq(tripsTable.id, tripId), eq(tripsTable.userId, this.userId)),
      )
      .returning({ id: tripsTable.id });
    return result.length > 0;
  }

  // ---- settings ----

  async getSettings(): Promise<UserSettings> {
    const rows = await this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.userId, this.userId));
    if (rows.length === 0) return { ...DEFAULT_SETTINGS };
    const row = rows[0];
    return {
      gmailLabelFilter: row.gmailLabelFilter ?? undefined,
      emailScanIntervalMinutes: row.emailScanIntervalMinutes,
      notificationsEnabled: row.notificationsEnabled,
    };
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    const now = new Date();
    await this.db
      .insert(settingsTable)
      .values({
        userId: this.userId,
        gmailLabelFilter: settings.gmailLabelFilter ?? null,
        emailScanIntervalMinutes: settings.emailScanIntervalMinutes,
        notificationsEnabled: settings.notificationsEnabled,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: {
          gmailLabelFilter: settings.gmailLabelFilter ?? null,
          emailScanIntervalMinutes: settings.emailScanIntervalMinutes,
          notificationsEnabled: settings.notificationsEnabled,
          updatedAt: now,
        },
      });
  }

  // ---- processed emails ----

  async getProcessedEmails(): Promise<ProcessedEmail[]> {
    const rows = await this.db
      .select()
      .from(processedEmailsTable)
      .where(eq(processedEmailsTable.userId, this.userId))
      .orderBy(asc(processedEmailsTable.createdAt));

    return rows.map((row) => ({
      gmailMessageId: row.messageId,
      gmailThreadId: row.threadId ?? undefined,
      subject: row.subject ?? undefined,
      fromAddress: row.fromAddress ?? undefined,
      receivedAt: row.receivedAt?.toISOString(),
      parsedType: row.parsedType ?? undefined,
      segmentId: row.segmentId ?? undefined,
      tripId: row.tripId ?? undefined,
      parseStatus: row.parseStatus as ProcessedEmail["parseStatus"],
      rawParseResult: row.parsedResult ?? undefined,
      provider: (row.provider as "google" | "microsoft") ?? undefined,
      accountEmail: row.accountEmail || undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async saveProcessedEmails(emails: ProcessedEmail[]): Promise<void> {
    // Replace-all matches the existing StorageProvider contract. The
    // `raw` column stays NULL for phase 1 rows — phase 4 will start
    // populating it once the connector layer surfaces full provider
    // message bodies through the parsing pipeline.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(processedEmailsTable)
        .where(eq(processedEmailsTable.userId, this.userId));
      if (emails.length === 0) return;
      await tx.insert(processedEmailsTable).values(
        emails.map((e) => ({
          // gmailMessageId is unique per (user, provider, account) for
          // gmail today; the unique constraint enforces it. We use it
          // directly as the row id so reparse / lookup-by-message
          // stays straightforward.
          id: e.gmailMessageId,
          userId: this.userId,
          // `provider` defaults to "google" at the column level, but
          // we explicitly pass it so Microsoft scans get the right
          // tag. `accountEmail` defaults to "" so legacy callers
          // that don't carry it through still satisfy the NOT NULL
          // column constraint.
          provider: e.provider ?? "google",
          accountEmail: e.accountEmail ?? "",
          messageId: e.gmailMessageId,
          threadId: e.gmailThreadId ?? null,
          subject: e.subject ?? null,
          fromAddress: e.fromAddress ?? null,
          receivedAt: e.receivedAt ? new Date(e.receivedAt) : null,
          parsedType: e.parsedType ?? null,
          segmentId: e.segmentId ?? null,
          tripId: e.tripId ?? null,
          parseStatus: e.parseStatus,
          parsedResult: (e.rawParseResult ?? null) as unknown,
          raw: null,
          createdAt: new Date(e.createdAt),
        })),
      );
    });
  }

  // ---- share rules ----

  async listShareRules(): Promise<TripShareRule[]> {
    const rows = await this.db
      .select()
      .from(shareRulesTable)
      .where(eq(shareRulesTable.ownerUserId, this.userId))
      .orderBy(asc(shareRulesTable.createdAt));
    return rows.map(shareRuleFromRow);
  }

  async getShareRule(ruleId: string): Promise<TripShareRule | null> {
    const rows = await this.db
      .select()
      .from(shareRulesTable)
      .where(
        and(
          eq(shareRulesTable.id, ruleId),
          eq(shareRulesTable.ownerUserId, this.userId),
        ),
      );
    return rows.length === 0 ? null : shareRuleFromRow(rows[0]);
  }

  async saveShareRule(rule: TripShareRule): Promise<void> {
    const createdAt = new Date(rule.createdAt);
    const updatedAt = new Date(rule.updatedAt);
    await this.db
      .insert(shareRulesTable)
      .values({
        id: rule.id,
        ownerUserId: this.userId,
        ownerEmail: rule.ownerEmail ?? null,
        sharedWithEmail: rule.sharedWithEmail,
        permission: rule.permission,
        showCosts: rule.showCosts,
        showTodos: rule.showTodos,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: shareRulesTable.id,
        set: {
          ownerEmail: rule.ownerEmail ?? null,
          sharedWithEmail: rule.sharedWithEmail,
          permission: rule.permission,
          showCosts: rule.showCosts,
          showTodos: rule.showTodos,
          updatedAt,
        },
      });
  }

  async deleteShareRule(ruleId: string): Promise<boolean> {
    const result = await this.db
      .delete(shareRulesTable)
      .where(
        and(
          eq(shareRulesTable.id, ruleId),
          eq(shareRulesTable.ownerUserId, this.userId),
        ),
      )
      .returning({ id: shareRulesTable.id });
    return result.length > 0;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    // Defence in depth: the route already constructs storage scoped to
    // `req.userId`, but reject a mismatch loudly so a future bug can't
    // turn the account-deletion endpoint into a cross-user wipe.
    if (userId !== this.userId) {
      throw new Error(
        `SupabaseStorage.deleteAllForUser: userId mismatch (got ${userId}, scoped to ${this.userId})`,
      );
    }
    // One transaction so partial failure can't leave a half-wiped
    // account behind. Deleting `trips` rows cascades to `segments`,
    // `todos`, `trip_history`, and `trip_shares` via FK
    // `onDelete: "cascade"`. `processed_emails.trip_id` is
    // `onDelete: "set null"`, but we delete the user's processed-emails
    // rows directly below so the cascade behaviour doesn't matter.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(tripsTable)
        .where(eq(tripsTable.userId, this.userId));
      await tx
        .delete(shareRulesTable)
        .where(eq(shareRulesTable.ownerUserId, this.userId));
      await tx
        .delete(processedEmailsTable)
        .where(eq(processedEmailsTable.userId, this.userId));
      await tx
        .delete(settingsTable)
        .where(eq(settingsTable.userId, this.userId));
    });
  }
}

// ---- row ↔ domain conversion ----

type TripRow = typeof tripsTable.$inferSelect;
type SegmentRow = typeof segmentsTable.$inferSelect;
type TodoRow = typeof todosTable.$inferSelect;
type HistoryRow = typeof historyTable.$inferSelect;
type ShareRuleRow = typeof shareRulesTable.$inferSelect;

function assembleTrip(
  row: TripRow,
  children: {
    segments: SegmentRow[];
    todos: TodoRow[];
    history: HistoryRow[];
  },
): Trip {
  const dayCities = (row.dayCities ?? {}) as Record<string, string>;
  const segmentsByDay = groupBy(children.segments, (s) => s.dayDate);

  const days: TripDay[] = enumerateDays(row.startDate, row.endDate).map(
    (date) => ({
      date,
      dayOfWeek: dayOfWeek(date),
      city: dayCities[date] ?? "",
      segments: (segmentsByDay.get(date) ?? []).map(segmentFromRow),
    }),
  );

  return {
    id: row.id,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as Trip["status"],
    days,
    todos: children.todos.map(todoFromRow),
    shares: ((row.shares as TripShare[] | null) ?? []) as TripShare[],
    history: children.history.map(historyFromRow),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    calendarId: row.calendarId ?? undefined,
    schemaVersion: row.schemaVersion,
  };
}

function segmentFromRow(row: SegmentRow): Segment {
  const data = (row.data ?? {}) as Record<string, unknown>;
  // Spread `data` FIRST so the typed columns below always win on overlap.
  // `segmentToRow` destructures the typed-column keys out of `seg` before
  // writing to `data`, so today the overlap is empty — but spreading data
  // last (the previous order) would let a stale jsonb `id`/`type`/`title`
  // from a hand-written migration silently clobber the canonical columns.
  // Object-spread is last-wins; make the safety explicit rather than rely
  // on the writer's destructure.
  return {
    ...(data as Partial<Segment>),
    id: row.id,
    type: row.type as Segment["type"],
    title: row.title,
    startTime: row.startTime ?? undefined,
    endTime: row.endTime ?? undefined,
    endDate: row.endDate ?? undefined,
    city: row.city ?? undefined,
    source: row.source as Segment["source"],
    sourceEmailId: row.sourceEmailId ?? undefined,
    needsReview: row.needsReview,
    sortOrder: row.sortOrder,
    calendarEventId: row.calendarEventId ?? undefined,
  };
}

function segmentToRow(
  seg: Segment,
  dayDate: string,
  tripId: string,
): typeof segmentsTable.$inferInsert {
  // Carved out of the segment: scalars handled by typed columns,
  // everything else goes into `data`. Keeps the column list short and
  // future variant additions zero-migration.
  const {
    id,
    type,
    title,
    startTime,
    endTime,
    endDate,
    city,
    source,
    sourceEmailId,
    needsReview,
    sortOrder,
    calendarEventId,
    ...data
  } = seg;
  return {
    id,
    tripId,
    dayDate,
    sortOrder,
    type,
    title,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    endDate: endDate ?? null,
    city: city ?? null,
    source,
    sourceEmailId: sourceEmailId ?? null,
    needsReview,
    calendarEventId: calendarEventId ?? null,
    data: data as Record<string, unknown>,
  };
}

function todoFromRow(row: TodoRow): Todo {
  return {
    id: row.id,
    text: row.text,
    isCompleted: row.isCompleted,
    category: (row.category ?? undefined) as Todo["category"],
    details: row.details ?? undefined,
    sortOrder: row.sortOrder,
  };
}

function todoToRow(
  todo: Todo,
  tripId: string,
): typeof todosTable.$inferInsert {
  return {
    id: todo.id,
    tripId,
    text: todo.text,
    isCompleted: todo.isCompleted,
    category: todo.category ?? null,
    details: todo.details ?? null,
    sortOrder: todo.sortOrder,
  };
}

function historyFromRow(row: HistoryRow): TripHistoryEntry {
  return {
    id: row.id,
    timestamp: row.ts.toISOString(),
    actor: { email: row.actorEmail, name: row.actorName ?? undefined },
    kind: row.kind as TripHistoryEntry["kind"],
    summary: row.summary,
    details: row.details ?? undefined,
    entityId: row.entityId ?? undefined,
  };
}

function historyToRow(
  entry: TripHistoryEntry,
  tripId: string,
): typeof historyTable.$inferInsert {
  return {
    id: entry.id,
    tripId,
    ts: new Date(entry.timestamp),
    actorEmail: entry.actor.email,
    actorName: entry.actor.name ?? null,
    kind: entry.kind,
    summary: entry.summary,
    details: entry.details ?? null,
    entityId: entry.entityId ?? null,
  };
}

function shareRuleFromRow(row: ShareRuleRow): TripShareRule {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail ?? undefined,
    sharedWithEmail: row.sharedWithEmail,
    permission: row.permission as TripShareRule["permission"],
    showCosts: row.showCosts,
    showTodos: row.showTodos,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---- helpers ----

function groupBy<T, K extends string | number>(
  items: T[],
  key: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function enumerateDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function dayOfWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return DAY_OF_WEEK_LABELS[d.getUTCDay()];
}
