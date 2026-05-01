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
import { formatFlightLabel, formatFlightEndpoint } from "./segments";
import { getCityTimezone } from "./city-timezone";
import { getAirportTimezone, lookupAirport } from "./airport-lookup";

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

/**
 * Returns tz offset in minutes (positive = east of UTC) for the given UTC instant.
 * Uses Date.UTC arithmetic on the local date/time parts so it is correct for any
 * reference time — including midnight UTC, where the simple hour-difference formula
 * wraps incorrectly for behind-UTC zones (e.g. New York at 00:00 UTC is still 19:00
 * the previous day, yielding a spurious +19 h with the arithmetic approach).
 */
function getUtcOffsetMinutes(referenceUtc: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(referenceUtc);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return (localMs - referenceUtc.getTime()) / 60_000;
}

/**
 * Compute the calendar date of arrival for a flight/train segment.
 * Returns depDate if arrival is on the same local-calendar date,
 * or depDate+1 when the flight crosses midnight in UTC (e.g. transatlantic).
 */
function resolveArrivalDate(
  depDate: string,
  depTime: string | undefined,
  depTz: string | undefined,
  arrTime: string | undefined,
  arrTz: string | undefined,
): string {
  if (!depTime || !arrTime || !depTz || !arrTz) return depDate;
  try {
    const ref = new Date(`${depDate}T12:00:00Z`);
    const depOffMin = getUtcOffsetMinutes(ref, depTz);
    const arrOffMin = getUtcOffsetMinutes(ref, arrTz);
    const [dh, dm] = depTime.slice(0, 5).split(":").map(Number);
    const [ah, am] = arrTime.slice(0, 5).split(":").map(Number);
    const depUtcMin = (dh ?? 0) * 60 + (dm ?? 0) - depOffMin;
    const arrSameDayUtcMin = (ah ?? 0) * 60 + (am ?? 0) - arrOffMin;
    return arrSameDayUtcMin > depUtcMin ? depDate : addDays(depDate, 1);
  } catch {
    return depDate;
  }
}

// ─── VTIMEZONE generation ─────────────────────────────────────────────────────

/** Format an offset in minutes as the ±HHMM used in TZOFFSETFROM / TZOFFSETTO. */
function fmtTzOff(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

/** Convert a UTC millisecond value to a local YYYYMMDDTHHMMSS string using a fixed offset. */
function utcMsToLocalDtStr(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return (
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0") +
    "T" +
    String(d.getUTCHours()).padStart(2, "0") +
    String(d.getUTCMinutes()).padStart(2, "0") +
    String(d.getUTCSeconds()).padStart(2, "0")
  );
}

/**
 * Binary-search for the UTC millisecond timestamp where the DST offset
 * changes between startMonth and endMonth (inclusive) in the given year.
 * Returns null if no transition is found. Result is within 1 minute of the
 * actual transition.
 */
function findTransitionMs(
  tz: string,
  year: number,
  startMonth: number,
  endMonth: number,
): number | null {
  let lo = Date.UTC(year, startMonth, 1);
  let hi = Date.UTC(year, endMonth + 1, 1);
  const offLo = getUtcOffsetMinutes(new Date(lo), tz);
  const offHi = getUtcOffsetMinutes(new Date(hi), tz);
  if (offLo === offHi) return null;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (getUtcOffsetMinutes(new Date(mid), tz) === offLo) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Build VTIMEZONE lines for an IANA timezone and a specific calendar year.
 *
 * Including a VTIMEZONE block in the iCal output is the RFC 5545-recommended
 * way to tell calendar clients (especially Outlook) the exact UTC offset —
 * including DST — for each TZID used in DTSTART/DTEND properties. Without
 * VTIMEZONE, Outlook sometimes uses the standard-time (winter) offset for
 * summer events, shifting them by 1 hour.
 *
 * The DAYLIGHT and STANDARD sub-components use the actual DST transition
 * dates for the given year, computed via binary search over Intl.DateTimeFormat.
 */
function buildVTimezone(tz: string, year: number): string[] {
  const offJan = getUtcOffsetMinutes(new Date(Date.UTC(year, 0, 15)), tz);
  const offJul = getUtcOffsetMinutes(new Date(Date.UTC(year, 6, 15)), tz);
  const lines: string[] = ["BEGIN:VTIMEZONE", `TZID:${tz}`];

  if (offJan === offJul) {
    // No DST — single STANDARD component with self-referential offsets.
    const off = fmtTzOff(offJan);
    lines.push("BEGIN:STANDARD", `DTSTART:${year}0101T000000`, `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, "END:STANDARD");
  } else {
    const hasDstInSummer = offJul > offJan;
    const stdOff = hasDstInSummer ? offJan : offJul;
    const dstOff = hasDstInSummer ? offJul : offJan;

    // Spring: standard → daylight (northern: Jan–Jun; southern: Jul–Nov)
    const springMs = hasDstInSummer
      ? findTransitionMs(tz, year, 0, 6)
      : findTransitionMs(tz, year, 6, 11);

    // Fall: daylight → standard (northern: Jul–Nov; southern: Jan–Jun)
    const fallMs = hasDstInSummer
      ? findTransitionMs(tz, year, 6, 11)
      : findTransitionMs(tz, year, 0, 6);

    if (springMs !== null) {
      // DTSTART is the wall-clock in STANDARD time at the spring transition.
      lines.push("BEGIN:DAYLIGHT", `DTSTART:${utcMsToLocalDtStr(springMs, stdOff)}`, `TZOFFSETFROM:${fmtTzOff(stdOff)}`, `TZOFFSETTO:${fmtTzOff(dstOff)}`, "END:DAYLIGHT");
    }
    if (fallMs !== null) {
      // DTSTART is the wall-clock in DAYLIGHT time at the fall transition.
      lines.push("BEGIN:STANDARD", `DTSTART:${utcMsToLocalDtStr(fallMs, dstOff)}`, `TZOFFSETFROM:${fmtTzOff(dstOff)}`, `TZOFFSETTO:${fmtTzOff(stdOff)}`, "END:STANDARD");
    }
  }

  lines.push("END:VTIMEZONE");
  return lines;
}

/** Collect every unique IANA timezone ID referenced by timed events in a trip. */
function collectTripTimezones(trip: Trip): Set<string> {
  const tzs = new Set<string>();
  const add = (tz: string | undefined) => { if (tz) tzs.add(tz); };
  for (const day of trip.days) {
    for (const segment of day.segments) {
      if (segment.type === "hotel" || segment.type === "car_rental") continue;
      if (segment.type === "flight" || segment.type === "train" || segment.type === "cruise") {
        add(getCityTimezone(segment.departureCity ?? segment.city ?? day.city));
        add(getCityTimezone(segment.arrivalCity ?? segment.city ?? day.city));
      } else {
        add(getCityTimezone(segment.city ?? day.city));
      }
    }
  }
  return tzs;
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

  // Prefer airport-derived timezones for flights when the IATA codes are
  // present; fall back to the city lookup for legacy data and other transport.
  const startTz =
    getAirportTimezone(segment.departureAirport) ??
    getCityTimezone(segment.departureCity ?? segment.city ?? day.city);
  const endTz =
    getAirportTimezone(segment.arrivalAirport) ??
    getCityTimezone(segment.arrivalCity ?? segment.city ?? day.city);
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
      const depAirport = lookupAirport(segment.departureAirport);
      const depLabel = formatFlightEndpoint(segment.departureAirport, segment.departureCity);
      const arrLabel = formatFlightEndpoint(segment.arrivalAirport, segment.arrivalCity);
      const route = [depLabel, arrLabel].filter(Boolean).join(" → ");
      summary = carrier ? `${carrier}: ${route || segment.title}` : `${label}: ${segment.title}`;
      if (route) descParts.push(route);
      if (segment.coach) descParts.push(`Coach: ${segment.coach}`);
      if (segment.seatNumber) descParts.push(`Seat: ${segment.seatNumber}`);
      if (segment.cabinClass) descParts.push(`Class: ${segment.cabinClass}`);
      if (segment.baggageInfo) descParts.push(`Baggage: ${segment.baggageInfo}`);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location =
        depAirport?.airportName ??
        segment.departureCity ??
        segment.city ??
        day.city;
      dtStart = dtProp("DTSTART", day.date, segment.startTime, startTz);
      const arrDate = resolveArrivalDate(
        day.date, segment.startTime, startTz, segment.endTime, endTz,
      );
      dtEnd = segment.endTime
        ? dtProp("DTEND", arrDate, segment.endTime, endTz)
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
      dtStart = dtProp("DTSTART", day.date);
      dtEnd = dtProp("DTEND", segment.endDate ?? addDays(day.date, 1));
      break;
    }

    case "car_rental": {
      const venue = segment.venueName ?? segment.title;
      summary = `${label}: ${venue}`;
      if (segment.address) descParts.push(segment.address);
      if (segment.confirmationCode) descParts.push(`Confirmation: ${segment.confirmationCode}`);
      location = segment.address ?? segment.city ?? day.city;
      dtStart = dtProp("DTSTART", day.date);
      dtEnd = dtProp("DTEND", segment.endDate ?? addDays(day.date, 1));
      break;
    }

    case "cruise": {
      const venue = segment.venueName ?? segment.title;
      summary = `${label}: ${venue}`;
      const route = [segment.departureCity, segment.arrivalCity]
        .filter(Boolean)
        .join(" → ");
      if (route) descParts.push(route);
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
    prop("UID", `${segment.id}@itinly`),
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
    "PRODID:-//itinly//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    textProp("X-WR-CALNAME", trip.title),
    textProp("X-WR-CALDESC", `Itinerary for ${safeTitle}`),
  ];

  // Emit VTIMEZONE definitions before VEVENTs so clients (especially Outlook)
  // have the exact DST rules for each TZID used in DTSTART/DTEND properties.
  const tripYear = parseInt(trip.startDate.slice(0, 4));
  for (const tz of collectTripTimezones(trip)) {
    try {
      lines.push(...buildVTimezone(tz, tripYear));
    } catch {
      // Skip if timezone is unrecognised — events will fall back to TZID lookup.
    }
  }

  for (const day of trip.days) {
    for (const segment of day.segments) {
      lines.push(...segmentToVEvent(segment, day, trip.title));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
