/**
 * RFC 5545 iCalendar (.ics) generator for trip itineraries.
 *
 * Produces a VCALENDAR with one VEVENT per segment. Timed events include a
 * TZID parameter so they display at the correct local time regardless of the
 * viewer's device timezone (e.g. a 09:00 Tokyo flight shows as 09:00 JST on
 * any calendar app — Apple Calendar, Outlook, Fastmail, Thunderbird, etc.).
 *
 * Transport segments (flight/train/cruise/car_rental) derive their start TZID
 * from the departure city and their end TZID from the arrival city.
 * Everything else uses the segment's own city or the containing day's city.
 *
 * Cities not in the lookup table produce floating datetimes (no TZID).
 */

import type { Trip, TripDay, Segment } from "../types/trip";
import { formatFlightLabel } from "./segments";
import { getCityTimezone } from "./city-timezone";

// ─── iCal text helpers ────────────────────────────────────────────────────────

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/**
 * Fold lines at 75 octets per RFC 5545 §3.1.
 * Continuation lines start with a single space.
 */
function foldLine(line: string): string {
  const LIMIT = 75;
  if (line.length <= LIMIT) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, LIMIT));
  let pos = LIMIT;
  while (pos < line.length) {
    chunks.push(" " + line.slice(pos, pos + LIMIT - 1));
    pos += LIMIT - 1;
  }
  return chunks.join("\r\n");
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function textProp(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

/** DTSTART / DTEND with optional TZID.  All-day when no time is given. */
function dtProp(propName: string, date: string, time?: string, tz?: string): string {
  if (!time) {
    // All-day: VALUE=DATE, no TZID
    const dateCompact = date.replace(/-/g, "");
    return `${propName};VALUE=DATE:${dateCompact}`;
  }
  const hhmm = time.slice(0, 5).replace(":", "");
  const dateCompact = date.replace(/-/g, "");
  const dt = `${dateCompact}T${hhmm}00`;
  if (tz) return foldLine(`${propName};TZID=${tz}:${dt}`);
  return `${propName}:${dt}`;
}

function dtstamp(): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return `DTSTAMP:${now}`;
}

// ─── Time helpers (mirrors google-calendar.ts) ────────────────────────────────

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

// ─── Segment → VEVENT ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  flight:               "Flight",
  train:                "Train",
  car_rental:           "Car Rental",
  car_service:          "Car",
  other_transport:      "Transport",
  hotel:                "Hotel",
  activity:             "Activity",
  show:                 "Show",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch:    "Brunch",
  restaurant_lunch:     "Lunch",
  restaurant_dinner:    "Dinner",
  tour:                 "Tour",
  cruise:               "Cruise",
};

function segmentToVEvent(
  segment: Segment,
  day: TripDay,
  tripTitle: string,
): string[] {
  const label = TYPE_LABELS[segment.type] ?? segment.type;

  const startTz = getCityTimezone(
    segment.departureCity ?? segment.city ?? day.city,
  );
  const endTz = getCityTimezone(
    segment.arrivalCity ?? segment.city ?? day.city,
  );
  const localTz = getCityTimezone(segment.city ?? day.city);

  let summary = "";
  let descParts: string[] = [];
  let location: string | undefined;
  let dtStart: string;
  let dtEnd: string;

  switch (segment.type) {
    case "flight":
    case "train": {
      const carrier = formatFlightLabel(segment);
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      summary = carrier ? `${carrier}: ${route || segment.title}` : `${label}: ${segment.title}`;
      if (route) descParts.push(route);
      if (segment.coach) descParts.push(`Coach: ${segment.coach}`);
      if (segment.seatNumber) descParts.push(`Seat: ${segment.seatNumber}`);
      if (segment.cabinClass) descParts.push(`Class: ${segment.cabinClass}`);
      if (segment.baggageInfo) descParts.push(`Baggage: ${segment.baggageInfo}`);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.departureCity ?? segment.city ?? day.city;
      dtStart = dtProp("DTSTART", day.date, segment.startTime, startTz);
      dtEnd = segment.endTime
        ? dtProp("DTEND", day.date, segment.endTime, endTz)
        : segment.startTime
          ? dtProp("DTEND", day.date, addHoursToTime(segment.startTime, 2), startTz)
          : dtProp("DTEND", addDays(day.date, 1));
      break;
    }

    case "hotel": {
      const venue = segment.venueName ?? segment.title;
      summary = `Hotel: ${venue}`;
      if (segment.address) descParts.push(segment.address);
      if (segment.breakfastIncluded) descParts.push("Breakfast included");
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.address ?? segment.city ?? day.city;
      dtStart = dtProp("DTSTART", day.date, segment.startTime, localTz);
      dtEnd = dtProp("DTEND", segment.endDate ?? addDays(day.date, 1), segment.endTime, localTz);
      break;
    }

    case "cruise":
    case "car_rental": {
      const venue = segment.venueName ?? segment.title;
      summary = `${label}: ${venue}`;
      if (segment.type === "cruise") {
        const route = [segment.departureCity, segment.arrivalCity]
          .filter(Boolean)
          .join(" → ");
        if (route) descParts.push(route);
      }
      if (segment.address) descParts.push(segment.address);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.address ?? segment.city ?? day.city;
      if (segment.endDate) {
        dtStart = dtProp("DTSTART", day.date, segment.startTime, startTz);
        dtEnd = dtProp("DTEND", segment.endDate, segment.endTime, endTz);
      } else {
        dtStart = dtProp("DTSTART", day.date, segment.startTime, localTz);
        dtEnd = segment.endTime
          ? dtProp("DTEND", day.date, segment.endTime, localTz)
          : segment.startTime
            ? dtProp("DTEND", day.date, addHoursToTime(segment.startTime, 2), localTz)
            : dtProp("DTEND", addDays(day.date, 1));
      }
      break;
    }

    case "restaurant_breakfast":
    case "restaurant_brunch":
    case "restaurant_lunch":
    case "restaurant_dinner": {
      const venue = segment.venueName ?? segment.title;
      summary = `${label}: ${venue}`;
      if (segment.partySize) descParts.push(`Party of ${segment.partySize}`);
      if (segment.creditCardHold) descParts.push("Credit card hold required");
      if (segment.cancellationDeadline) descParts.push(`Cancel by: ${segment.cancellationDeadline}`);
      if (segment.phone) descParts.push(`Phone: ${segment.phone}`);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.address ?? segment.venueName;
      dtStart = dtProp("DTSTART", day.date, segment.startTime, localTz);
      dtEnd = segment.endTime
        ? dtProp("DTEND", day.date, segment.endTime, localTz)
        : segment.startTime
          ? dtProp("DTEND", day.date, addHoursToTime(segment.startTime, 2), localTz)
          : dtProp("DTEND", addDays(day.date, 1));
      break;
    }

    default: {
      const venue = segment.venueName ?? segment.title;
      summary = `${label}: ${venue}`;
      if (segment.address) descParts.push(segment.address);
      if (segment.type === "car_service" && segment.contactName)
        descParts.push(`Driver: ${segment.contactName}`);
      if (segment.type === "show" && segment.seatNumber)
        descParts.push(`Seat: ${segment.seatNumber}`);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.address ?? segment.city ?? day.city;
      dtStart = dtProp("DTSTART", day.date, segment.startTime, localTz);
      dtEnd = segment.endTime
        ? dtProp("DTEND", day.date, segment.endTime, localTz)
        : segment.startTime
          ? dtProp("DTEND", day.date, addHoursToTime(segment.startTime, 1), localTz)
          : dtProp("DTEND", addDays(day.date, 1));
      break;
    }
  }

  const lines = [
    "BEGIN:VEVENT",
    prop("UID", `${segment.id}@travel-itinerary-maker`),
    dtstamp(),
    dtStart,
    dtEnd,
    textProp("SUMMARY", `${summary} (${tripTitle})`),
  ];
  if (descParts.length) lines.push(textProp("DESCRIPTION", descParts.join("\n")));
  if (location) lines.push(textProp("LOCATION", location));
  lines.push("END:VEVENT");
  return lines;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a complete RFC 5545 iCalendar string for a trip.
 * The returned string uses CRLF line endings as required by the spec.
 */
export function tripToIcal(trip: Trip): string {
  const safeTitle = escapeText(trip.title);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Travel Itinerary Maker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    textProp("X-WR-CALNAME", trip.title),
    textProp("X-WR-CALDESC", `Itinerary for ${safeTitle}`),
  ];

  for (const day of trip.days) {
    for (const segment of day.segments) {
      lines.push(...segmentToVEvent(segment, day, trip.title));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
