/**
 * Microsoft Graph implementation of `CalendarConnector`. Translates
 * the existing `segmentToEvent` output (Google's `calendar_v3.Schema$Event`
 * shape) to Microsoft Graph's event shape and POSTs / PATCHes /
 * DELETEs against `/me/calendars/{id}/events`.
 *
 * Why translate from Google's shape instead of building a parallel
 * `segmentToMicrosoftEvent`: `segmentToEvent` already encodes
 * substantial segment-type knowledge (flight summary formatting,
 * hotel all-day handling, transport timezone routing). Duplicating
 * that into a Microsoft-shaped builder would double the maintenance
 * surface — when a new segment type lands, both would need to know
 * about it. The translator approach pays a small adapter cost in
 * exchange for one source of truth per segment-type rule.
 *
 * Token: the connector receives an access token directly. Refresh
 * logic belongs one layer up (Phase 4b-2's resolver upgrade reads
 * the refresh_token from the user's `connections` row and refreshes
 * before constructing the connector).
 *
 * What's NOT here:
 *  - Existing-event matching (Google's "match airline-added events
 *    that already exist on the calendar"). Outlook doesn't get the
 *    same airline auto-population that Google does, and the
 *    matching logic depends on calendar-format-specific event
 *    structure. Microsoft sync always creates events for segments
 *    without a `calendarEventId`.
 *  - Recurrence. Trips don't have recurring segments today; both
 *    Google and Microsoft connectors treat every segment as a
 *    single occurrence.
 */

import type { Trip, TripDay, Segment } from "@itinly/shared";
import type { calendar_v3 } from "googleapis";
import { segmentToEvent } from "../services/google-calendar";
import {
  graphRequest,
  graphPaginate,
  GraphError,
} from "../services/microsoft-graph";
import type {
  CalendarConnector,
  CalendarEntry,
  CalendarSyncResult,
  CalendarUnsyncResult,
  SegmentSyncResult,
} from "./calendar-connector";

interface MsCalendar {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
}

interface MsEventDateTime {
  dateTime: string;
  timeZone: string;
}

interface MsEvent {
  id?: string;
  subject?: string;
  body?: { contentType: "text" | "html"; content: string };
  start?: MsEventDateTime;
  end?: MsEventDateTime;
  location?: { displayName: string };
  isAllDay?: boolean;
  reminderMinutesBeforeStart?: number;
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    type?: "required" | "optional" | "resource";
  }>;
  singleValueExtendedProperties?: Array<{ id: string; value: string }>;
}

/**
 * Microsoft's "single-value extended properties" identifier for our
 * trip-id stamp. Format: `String {<GUID>} Name <name>`. The GUID is a
 * Microsoft Office shared property set; using a stable GUID + name
 * means the property can be read back later to associate events with
 * trips without depending on event subject parsing.
 */
const TRIP_ID_PROPERTY_ID =
  "String {00020329-0000-0000-c000-000000000046} Name ItinlyTripId";

/**
 * Companion to `TRIP_ID_PROPERTY_ID`. Stamped on every event we create
 * so a subsequent `syncTrip` can rebuild the `segmentId → eventId`
 * map even when the segment's `calendarEventId` was cleared (e.g. the
 * user used "Remove sync, keep events" then re-synced). Without this,
 * the re-sync sees no `calendarEventId` on the segment, queries
 * nothing back from Graph, and just creates duplicates alongside the
 * orphan events.
 */
const SEGMENT_ID_PROPERTY_ID =
  "String {00020329-0000-0000-c000-000000000046} Name ItinlySegmentId";

/**
 * Translates a Google-shaped event (output of `segmentToEvent`) to a
 * Microsoft Graph event. Mirrors `segmentToEvent`'s output 1:1 — the
 * only meaningful difference is the all-day representation.
 *
 * Google all-day events use `{ date: "YYYY-MM-DD" }` on both start
 * and end; Microsoft always uses `dateTime + timeZone` with
 * `isAllDay: true` and times pinned at midnight UTC.
 */
export function googleEventToMsEvent(
  event: calendar_v3.Schema$Event,
  userEmail?: string,
): MsEvent {
  const result: MsEvent = {
    subject: event.summary ?? "",
    body: {
      contentType: "text",
      content: event.description ?? "",
    },
    location: { displayName: event.location ?? "" },
    reminderMinutesBeforeStart: 15,
  };

  if (event.start?.date) {
    // All-day event in Google. Microsoft requires `dateTime + timeZone`
    // with `isAllDay: true`. The MS docs say the times must be at
    // midnight in the specified time zone — UTC midnight is the safest
    // default since Google's all-day events are timezone-agnostic too.
    result.isAllDay = true;
    result.start = { dateTime: `${event.start.date}T00:00:00`, timeZone: "UTC" };
    result.end = {
      dateTime: `${event.end?.date ?? event.start.date}T00:00:00`,
      timeZone: "UTC",
    };
  } else {
    result.isAllDay = false;
    result.start = {
      dateTime: event.start?.dateTime ?? "",
      timeZone: event.start?.timeZone ?? "UTC",
    };
    result.end = {
      dateTime: event.end?.dateTime ?? "",
      timeZone: event.end?.timeZone ?? "UTC",
    };
  }

  if (userEmail) {
    result.attendees = [
      {
        emailAddress: { address: userEmail },
        type: "required",
      },
    ];
  }

  // Pull tripId / segmentId off the Google-shaped extended properties
  // and re-stamp them in Graph's single-value extended-properties
  // format. Both are queryable via `$filter` on subsequent syncs,
  // which is how we rebuild the segmentId→eventId map after a
  // "remove sync, keep events" round-trip clears `calendarEventId`
  // on the segments.
  const extProps: Array<{ id: string; value: string }> = [];
  const tripId = event.extendedProperties?.private?.tripId;
  if (tripId) extProps.push({ id: TRIP_ID_PROPERTY_ID, value: tripId });
  const segmentId = event.extendedProperties?.private?.segmentId;
  if (segmentId) extProps.push({ id: SEGMENT_ID_PROPERTY_ID, value: segmentId });
  if (extProps.length > 0) {
    result.singleValueExtendedProperties = extProps;
  }

  return result;
}

/**
 * Resolves a public-facing calendarId to the path segment used in
 * Microsoft Graph URLs. `"primary"` (our cross-provider sentinel for
 * "the user's default calendar") maps to Graph's `/me/calendar`
 * (no plural — distinct from `/me/calendars/<id>`). Real calendar
 * IDs route through `/me/calendars/<id>`.
 */
function calendarPath(calendarId: string): string {
  return calendarId === "primary" ? "/me/calendar" : `/me/calendars/${calendarId}`;
}

function logPrefix(trip: Trip, userEmail?: string): string {
  const who = userEmail ? `mscal ${userEmail}` : "mscal";
  return `[${who} trip=${trip.id}]`;
}

export class MicrosoftCalendarConnector implements CalendarConnector {
  constructor(private readonly accessToken: string) {}

  async listCalendars(): Promise<CalendarEntry[]> {
    const cals = await graphPaginate<MsCalendar>(
      this.accessToken,
      "/me/calendars",
      { query: { $select: "id,name,isDefaultCalendar" } },
    );
    return cals.map((c) => ({
      id: c.id,
      summary: c.name ?? "(unnamed calendar)",
      primary: c.isDefaultCalendar === true,
    }));
  }

  async syncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarSyncResult> {
    const prefix = logPrefix(trip, userEmail);
    const result: CalendarSyncResult = {
      created: 0,
      updated: 0,
      failed: 0,
      calendarId,
      eventMap: {},
    };

    // Pre-fetch any events on this calendar that we previously
    // created for this trip. Drives the orphan-recovery path in
    // upsertSegmentEvent so segments missing their `calendarEventId`
    // (e.g. after the user used "Remove sync, keep events" + then
    // re-synced) get matched back to the still-live event instead of
    // duplicating it. Only useful for events created at or after the
    // commit that started stamping ItinlySegmentId — anything older
    // won't be matchable.
    const needsOrphanLookup = trip.days.some((d) =>
      d.segments.some((s) => !s.calendarEventId),
    );
    let existingBySegmentId: Map<string, string> = new Map();
    if (needsOrphanLookup) {
      try {
        existingBySegmentId = await this.listExistingTripEvents(
          calendarId,
          trip.id,
        );
        if (existingBySegmentId.size > 0) {
          console.log(
            `${prefix} Found ${existingBySegmentId.size} prior event(s) for trip via extended property — will reuse where possible`,
          );
        }
      } catch (err) {
        // Don't fail the whole sync if the orphan lookup blows up —
        // worst case we duplicate a few events, which is the existing
        // behavior. Log + continue.
        console.warn(
          `${prefix} Orphan-event lookup failed: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }
    }

    for (const day of trip.days) {
      for (const segment of day.segments) {
        try {
          // Orphan recovery: when a segment lost its `calendarEventId`
          // (e.g. the user used "Remove sync, keep events" and then
          // re-synced) but a previously-created event for that segment
          // still exists on the calendar, reuse it instead of creating
          // a duplicate alongside the orphan. Build an effective
          // segment (shallow copy with the recovered id) rather than
          // mutating the caller's object — the route handler in
          // calendar.ts also writes the result.eventMap back onto
          // segments after sync, so mutating here would shadow that
          // assignment for the eventMap-recovery case.
          const reuseId =
            !segment.calendarEventId &&
            existingBySegmentId.get(segment.id);
          const effectiveSegment = reuseId
            ? { ...segment, calendarEventId: reuseId }
            : segment;
          if (reuseId) {
            console.log(
              `${prefix} Reusing existing event ${reuseId} for "${segment.title}" (orphaned from earlier sync)`,
            );
          }
          const eventId = await this.upsertSegmentEvent(
            trip,
            day,
            effectiveSegment,
            calendarId,
            userEmail,
            prefix,
          );
          // Match the prior accounting rule: same event id round-trip
          // = "updated"; a different id (e.g. the recovery fell
          // through to create because the orphan event was deleted
          // out-of-band, or we never had one) = "created".
          if (effectiveSegment.calendarEventId === eventId.id) {
            result.updated++;
          } else {
            result.created++;
          }
          result.eventMap[segment.id] = eventId.id;
        } catch (err) {
          result.failed++;
          console.warn(
            `${prefix} Failed segment "${segment.title}": ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
        }
      }
    }

    console.log(
      `${prefix} Done: ${result.created} created, ${result.updated} updated, ${result.failed} failed (calendarId=${calendarId})`,
    );
    return result;
  }

  async syncSegment(
    trip: Trip,
    day: TripDay,
    segment: Segment,
    calendarId: string,
    userEmail?: string,
  ): Promise<SegmentSyncResult> {
    const prefix = logPrefix(trip, userEmail);
    try {
      const wasUpdate = !!segment.calendarEventId;
      const upserted = await this.upsertSegmentEvent(
        trip,
        day,
        segment,
        calendarId,
        userEmail,
        prefix,
      );
      return {
        created: wasUpdate ? 0 : 1,
        updated: wasUpdate ? 1 : 0,
        failed: 0,
        eventId: upserted.id,
      };
    } catch (err) {
      console.warn(
        `${prefix} Failed single segment sync "${segment.title}": ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return { created: 0, updated: 0, failed: 1 };
    }
  }

  async unsyncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarUnsyncResult> {
    const prefix = logPrefix(trip, userEmail);
    let removed = 0;
    let failed = 0;
    for (const day of trip.days) {
      for (const segment of day.segments) {
        if (!segment.calendarEventId) continue;
        try {
          await graphRequest(
            this.accessToken,
            `${calendarPath(calendarId)}/events/${segment.calendarEventId}`,
            { method: "DELETE" },
          );
          removed++;
        } catch (err) {
          // 404 = already gone → still a success from the unsync POV.
          if (err instanceof GraphError && err.status === 404) {
            removed++;
            continue;
          }
          failed++;
          console.warn(
            `${prefix} Failed to delete ${segment.calendarEventId}: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
        }
      }
    }
    console.log(
      `${prefix} Unsync done: ${removed} removed, ${failed} failed (calendarId=${calendarId})`,
    );
    return { removed, failed };
  }

  /**
   * Shared create-or-update path used by both `syncTrip` and
   * `syncSegment`. Builds the MS event from the segment, then either
   * PATCHes the existing event or POSTs a new one. If the existing
   * event was deleted out-of-band (Graph 404), falls back to a
   * create — matches the existing Google behaviour.
   */
  private async upsertSegmentEvent(
    trip: Trip,
    day: TripDay,
    segment: Segment,
    calendarId: string,
    userEmail: string | undefined,
    prefix: string,
  ): Promise<{ id: string }> {
    const googleShaped = segmentToEvent(segment, day, trip.title);
    // segmentToEvent leaves tripId blank for the caller to fill in.
    googleShaped.extendedProperties!.private!.tripId = trip.id;
    const msEvent = googleEventToMsEvent(googleShaped, userEmail);

    if (segment.calendarEventId) {
      try {
        const updated = await graphRequest<MsEvent>(
          this.accessToken,
          `${calendarPath(calendarId)}/events/${segment.calendarEventId}`,
          { method: "PATCH", body: msEvent },
        );
        if (!updated?.id) {
          throw new Error("PATCH response missing event id");
        }
        console.log(
          `${prefix} Updated "${segment.title}" (${segment.calendarEventId})`,
        );
        return { id: updated.id };
      } catch (err) {
        if (err instanceof GraphError && err.status === 404) {
          // Event was deleted from the calendar — fall through to create.
          console.log(
            `${prefix} Existing event ${segment.calendarEventId} gone — recreating`,
          );
        } else {
          throw err;
        }
      }
    }

    const created = await graphRequest<MsEvent>(
      this.accessToken,
      `${calendarPath(calendarId)}/events`,
      { method: "POST", body: msEvent },
    );
    if (!created?.id) {
      throw new Error("POST response missing event id");
    }
    console.log(`${prefix} Created "${segment.title}" → ${created.id}`);
    return { id: created.id };
  }

  /**
   * Queries the calendar for events we previously created for this
   * trip and returns a `segmentId → eventId` map.
   *
   * Uses Graph's `$filter` on `singleValueExtendedProperties` —
   * matches every event with our `ItinlyTripId` property set to this
   * trip's id. Each matched event's `ItinlySegmentId` (also stamped
   * at create time) becomes the map key. Events created before we
   * started stamping `SEGMENT_ID_PROPERTY_ID` won't be matchable
   * here; that's the forward-looking limit.
   *
   * Returning an empty map on any error is safe — the caller will
   * just fall through to the existing CREATE path. The orphan-
   * recovery is best-effort, not correctness-critical.
   */
  private async listExistingTripEvents(
    calendarId: string,
    tripId: string,
  ): Promise<Map<string, string>> {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${TRIP_ID_PROPERTY_ID}' and ep/value eq '${tripId}')`;
    const expand = `singleValueExtendedProperties($filter=id eq '${SEGMENT_ID_PROPERTY_ID}')`;
    interface EventWithExtProps {
      id: string;
      singleValueExtendedProperties?: Array<{ id: string; value: string }>;
    }
    const events = await graphPaginate<EventWithExtProps>(
      this.accessToken,
      `${calendarPath(calendarId)}/events`,
      {
        query: {
          $filter: filter,
          $expand: expand,
          $top: "100",
          $select: "id",
        },
      },
    );
    const map = new Map<string, string>();
    for (const event of events) {
      const segProp = event.singleValueExtendedProperties?.find(
        (p) => p.id === SEGMENT_ID_PROPERTY_ID,
      );
      if (segProp && event.id) {
        map.set(segProp.value, event.id);
      }
    }
    return map;
  }
}
