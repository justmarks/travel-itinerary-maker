import { google, type calendar_v3 } from "googleapis";
import type { Trip, TripDay, Segment } from "@travel-app/shared";
import { formatFlightLabel } from "@travel-app/shared";
import { getCityTimezone } from "@travel-app/shared";

export interface CalendarSyncResult {
  created: number;
  updated: number;
  failed: number;
  calendarId: string;
  /** Map of segmentId → calendarEventId for segments that were created/updated */
  eventMap: Record<string, string>;
}

export interface CalendarUnsyncResult {
  removed: number;
  failed: number;
}

function buildClient(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function addHoursToTime(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + (m ?? 0) + hours * 60;
  return `${String(Math.min(Math.floor(total / 60), 23)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateTime(
  date: string,
  time?: string,
  tz?: string,
): calendar_v3.Schema$EventDateTime {
  if (!time) return { date };
  const t = time.length === 5 ? time + ":00" : time;
  const dt: calendar_v3.Schema$EventDateTime = { dateTime: `${date}T${t}` };
  if (tz) dt.timeZone = tz;
  return dt;
}

// ─── Segment → Calendar Event ─────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  flight: "Flight",
  train: "Train",
  car_rental: "Car Rental",
  car_service: "Car",
  other_transport: "Transport",
  hotel: "Hotel",
  activity: "Activity",
  show: "Show",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch: "Brunch",
  restaurant_lunch: "Lunch",
  restaurant_dinner: "Dinner",
  tour: "Tour",
  cruise: "Cruise",
};

export function segmentToEvent(
  segment: Segment,
  day: TripDay,
  tripTitle: string,
): calendar_v3.Schema$Event {
  const label = TYPE_LABELS[segment.type] ?? segment.type;
  let summary: string;
  let description: string;
  let location: string | undefined;
  let start: calendar_v3.Schema$EventDateTime;
  let end: calendar_v3.Schema$EventDateTime;

  // Derive IANA timezones from the cities associated with this segment.
  // Transport uses departure city for start and arrival city for end so a
  // flight from Tokyo to Paris shows 09:00 JST departure and 18:00 CET
  // arrival regardless of the user's device zone. All other segments use
  // the segment's own city or the day city.
  const startTz = getCityTimezone(
    segment.departureCity ?? segment.city ?? day.city,
  );
  const endTz = getCityTimezone(
    segment.arrivalCity ?? segment.city ?? day.city,
  );
  // For non-transport segments start and end are in the same place.
  const localTz = getCityTimezone(segment.city ?? day.city);

  switch (segment.type) {
    case "flight":
    case "train": {
      const carrier = formatFlightLabel(segment);
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      summary = carrier ? `${carrier}${route ? ": " + route : ""}` : `${label}: ${segment.title}`;
      const desc: string[] = [];
      if (route) desc.push(route);
      if (segment.coach) desc.push(`Coach: ${segment.coach}`);
      if (segment.seatNumber) desc.push(`Seat: ${segment.seatNumber}`);
      if (segment.cabinClass) desc.push(`Class: ${segment.cabinClass}`);
      if (segment.baggageInfo) desc.push(`Baggage: ${segment.baggageInfo}`);
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.departureCity || segment.city || day.city;
      // Start in departure city TZ; end in arrival city TZ.
      start = dateTime(day.date, segment.startTime, startTz);
      end = segment.endTime
        ? dateTime(day.date, segment.endTime, endTz)
        : segment.startTime
          ? dateTime(day.date, addHoursToTime(segment.startTime, 2), startTz)
          : { date: addDays(day.date, 1) };
      break;
    }

    case "hotel": {
      const venue = segment.venueName || segment.title;
      summary = `Hotel: ${venue}`;
      const desc: string[] = [];
      if (segment.address) desc.push(segment.address);
      if (segment.breakfastIncluded) desc.push("Breakfast included");
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.address || segment.city || day.city;
      start = { date: day.date };
      end = { date: segment.endDate ?? addDays(day.date, 1) };
      break;
    }

    case "car_rental": {
      const venue = segment.venueName || segment.title;
      summary = `${label}: ${venue}`;
      const desc: string[] = [];
      if (segment.address) desc.push(segment.address);
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.address || segment.city || day.city;
      start = { date: day.date };
      end = { date: segment.endDate ?? addDays(day.date, 1) };
      break;
    }

    case "cruise": {
      const venue = segment.venueName || segment.title;
      summary = `${label}: ${venue}`;
      const desc: string[] = [];
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      if (route) desc.push(route);
      if (segment.address) desc.push(segment.address);
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.address || segment.city || day.city;
      if (segment.endDate) {
        start = dateTime(day.date, segment.startTime, startTz);
        end = dateTime(segment.endDate, segment.endTime, endTz);
      } else {
        start = dateTime(day.date, segment.startTime, localTz);
        end = segment.endTime
          ? dateTime(day.date, segment.endTime, localTz)
          : segment.startTime
            ? dateTime(day.date, addHoursToTime(segment.startTime, 2), localTz)
            : { date: addDays(day.date, 1) };
      }
      break;
    }

    case "restaurant_breakfast":
    case "restaurant_brunch":
    case "restaurant_lunch":
    case "restaurant_dinner": {
      const venue = segment.venueName || segment.title;
      summary = `${label}: ${venue}`;
      const desc: string[] = [];
      if (segment.partySize) desc.push(`Party of ${segment.partySize}`);
      if (segment.creditCardHold) desc.push("Credit card hold required");
      if (segment.cancellationDeadline) desc.push(`Cancel by: ${segment.cancellationDeadline}`);
      if (segment.phone) desc.push(`Phone: ${segment.phone}`);
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.address || segment.venueName;
      start = dateTime(day.date, segment.startTime, localTz);
      end = segment.endTime
        ? dateTime(day.date, segment.endTime, localTz)
        : segment.startTime
          ? dateTime(day.date, addHoursToTime(segment.startTime, 2), localTz)
          : { date: addDays(day.date, 1) };
      break;
    }

    default: {
      const venue = segment.venueName || segment.title;
      summary = `${label}: ${venue}`;
      const desc: string[] = [];
      if (segment.address) desc.push(segment.address);
      if (segment.type === "car_service" && segment.contactName)
        desc.push(`Driver: ${segment.contactName}`);
      if (segment.type === "show" && segment.seatNumber)
        desc.push(`Seat: ${segment.seatNumber}`);
      if (segment.confirmationCode) desc.push(`Confirmation: ${segment.confirmationCode}`);
      description = desc.join("\n");
      location = segment.address || segment.city || day.city;
      start = dateTime(day.date, segment.startTime, localTz);
      end = segment.endTime
        ? dateTime(day.date, segment.endTime, localTz)
        : segment.startTime
          ? dateTime(day.date, addHoursToTime(segment.startTime, 1), localTz)
          : { date: addDays(day.date, 1) };
      break;
    }
  }

  return {
    summary,
    description: description || undefined,
    location,
    start,
    end,
    extendedProperties: {
      private: {
        source: "travel-itinerary-maker",
        tripTitle,
        tripId: "",      // filled in by caller
        segmentId: segment.id,
      },
    },
  };
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncTripToCalendar(
  accessToken: string,
  trip: Trip,
  calendarId = "primary",
): Promise<CalendarSyncResult> {
  const cal = buildClient(accessToken);
  const result: CalendarSyncResult = {
    created: 0,
    updated: 0,
    failed: 0,
    calendarId,
    eventMap: {},
  };

  for (const day of trip.days) {
    for (const segment of day.segments) {
      try {
        const event = segmentToEvent(segment, day, trip.title);
        event.extendedProperties!.private!.tripId = trip.id;

        if (segment.calendarEventId) {
          try {
            await cal.events.update({
              calendarId,
              eventId: segment.calendarEventId,
              requestBody: event,
            });
            result.updated++;
            result.eventMap[segment.id] = segment.calendarEventId;
          } catch (err: unknown) {
            const status =
              (err as { code?: number }).code ??
              (err as { status?: number }).status;
            if (status === 404 || status === 410) {
              // Event was deleted from calendar — re-create it
              const res = await cal.events.insert({ calendarId, requestBody: event });
              result.created++;
              result.eventMap[segment.id] = res.data.id!;
            } else {
              throw err;
            }
          }
        } else {
          const res = await cal.events.insert({ calendarId, requestBody: event });
          result.created++;
          result.eventMap[segment.id] = res.data.id!;
        }
      } catch {
        result.failed++;
      }
    }
  }

  return result;
}

export async function unsyncTripFromCalendar(
  accessToken: string,
  trip: Trip,
  calendarId = "primary",
): Promise<CalendarUnsyncResult> {
  const cal = buildClient(accessToken);
  const result: CalendarUnsyncResult = { removed: 0, failed: 0 };

  for (const day of trip.days) {
    for (const segment of day.segments) {
      if (!segment.calendarEventId) continue;
      try {
        await cal.events.delete({ calendarId, eventId: segment.calendarEventId });
        result.removed++;
      } catch (err: unknown) {
        const status =
          (err as { code?: number }).code ??
          (err as { status?: number }).status;
        if (status === 404 || status === 410) {
          result.removed++; // already gone — counts as removed
        } else {
          result.failed++;
        }
      }
    }
  }

  return result;
}
