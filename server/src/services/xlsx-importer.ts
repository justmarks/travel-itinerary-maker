import ExcelJS, { ValueType } from "exceljs";
import type { SegmentType, SegmentCost } from "@travel-app/shared";

/**
 * A segment as parsed from the spreadsheet — a strict subset of the fields
 * the domain `Segment` supports. The importer only populates what it can
 * reliably extract from the source cells; the rest is left blank and the
 * user can fill in via the UI after import.
 */
export interface ParsedWorkbookSegment {
  type: SegmentType;
  title: string;
  startTime?: string;
  endTime?: string;
  venueName?: string;
  address?: string;
  phone?: string;
  city?: string;
  departureCity?: string;
  arrivalCity?: string;
  /** Check-out date for hotels (YYYY-MM-DD) */
  endDate?: string;
  confirmationCode?: string;
  partySize?: number;
  creditCardHold?: boolean;
  cost?: SegmentCost;
  /** Raw source text, preserved for debugging / fallback display */
  rawText: string;
}

export interface ParsedWorkbookDay {
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // "Mon", "Tue", …
  city: string;
  segments: ParsedWorkbookSegment[];
}

/** A cost row from the "Costs" sheet */
export interface ParsedWorkbookCost {
  category: string;
  amount: number;
  currency: string;
  details?: string;
}

export interface ParsedWorkbook {
  title: string;
  startDate: string;
  endDate: string;
  days: ParsedWorkbookDay[];
  costs: ParsedWorkbookCost[];
  /** Non-fatal warnings produced during parsing */
  warnings: string[];
}

/**
 * Pull a 4-digit year out of a piece of free text (usually a trip title or
 * filename). Returns the first plausible match or `undefined` if none.
 *
 * We only accept years in the range 1900-2099 to avoid pulling numbers like
 * confirmation codes or hotel room numbers. The year must be delimited by a
 * non-digit boundary so "Room 2145" doesn't match as 2145.
 */
export function extractYearHint(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Shift every date in a parsed workbook by `deltaYears`. Used when we
 * detect that ExcelJS inferred the wrong year (e.g. the workbook has
 * year-less cells that defaulted to the current year at entry time, but
 * the trip title or filename names a different year).
 */
export function shiftWorkbookYears(
  book: ParsedWorkbook,
  deltaYears: number,
): ParsedWorkbook {
  if (deltaYears === 0) return book;
  const shift = (iso: string) => {
    const y = Number(iso.slice(0, 4));
    if (!Number.isFinite(y)) return iso;
    return `${String(y + deltaYears).padStart(4, "0")}${iso.slice(4)}`;
  };
  return {
    ...book,
    startDate: shift(book.startDate),
    endDate: shift(book.endDate),
    days: book.days.map((d) => ({ ...d, date: shift(d.date) })),
  };
}

/* ─────────────────────────────────────────────────────────
 * Low-level row reader
 *   Converts the raw ExcelJS worksheet into a column-keyed
 *   matrix so the day-grouping logic can operate on plain
 *   strings without ExcelJS-specific types leaking through.
 * ────────────────────────────────────────────────────────── */

interface RawRow {
  A: string;
  B: string;
  C: string; // raw date text (or ISO date)
  D: string;
  E: string;
  F: string;
  G: string;
  /** Original row number in the sheet (for debugging) */
  rowNum: number;
  /** Non-empty `C` cell that parsed to a valid date, formatted as YYYY-MM-DD */
  cDate: string | undefined;
}

/** Flatten a cell into a plain string, handling ExcelJS rich text, formulas, dates, numbers.
 *  Returns "" for merge-slave cells so row-grouping logic can treat them as blank. */
function cellToString(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  // Merge slaves inherit their master's value — treat as empty for row parsing.
  if (cell.type === ValueType.Merge) return "";
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Rich text
    if ("richText" in value && Array.isArray((value as { richText: unknown[] }).richText)) {
      return (value as { richText: { text: string }[] }).richText
        .map((r) => r.text)
        .join("")
        .trim();
    }
    // Hyperlink
    if ("text" in value && typeof (value as { text: unknown }).text === "string") {
      return (value as { text: string }).text.trim();
    }
    // Formula with cached result
    if ("result" in value) {
      const result = (value as { result: unknown }).result;
      if (result instanceof Date) return result.toISOString();
      if (typeof result === "number" || typeof result === "string") return String(result);
    }
  }
  return String(value).trim();
}

/** Try to convert a column-C cell value into a YYYY-MM-DD ISO date.
 *  Returns undefined for merge-slave cells so only the master row starts a new day. */
function cellToIsoDate(cell: ExcelJS.Cell | undefined): string | undefined {
  if (!cell || cell.value === null || cell.value === undefined) return undefined;
  if (cell.type === ValueType.Merge) return undefined;
  const v = cell.value;

  // Excel date serial (number)
  if (typeof v === "number") {
    // Excel epoch quirk: 1900-based, with a phantom Feb 29, 1900
    // Standard formula: (serial - 25569) days since Unix epoch
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Native Date object (exceljs usually returns dates this way)
  if (v instanceof Date) {
    // Use UTC slice — Excel dates are timezone-agnostic, and `v` is already
    // constructed from the raw serial by ExcelJS at UTC midnight.
    return v.toISOString().slice(0, 10);
  }

  // Formula cell with cached date result
  if (typeof v === "object" && "result" in v) {
    const result = (v as { result: unknown }).result;
    if (result instanceof Date) return result.toISOString().slice(0, 10);
    if (typeof result === "number") {
      const ms = (result - 25569) * 86400 * 1000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  // String that's already an ISO date or parseable
  if (typeof v === "string") {
    const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return undefined;
}

function readSheet(ws: ExcelJS.Worksheet): RawRow[] {
  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
    const raw: RawRow = {
      A: cellToString(row.getCell(1)),
      B: cellToString(row.getCell(2)),
      C: cellToString(row.getCell(3)),
      D: cellToString(row.getCell(4)),
      E: cellToString(row.getCell(5)),
      F: cellToString(row.getCell(6)),
      G: cellToString(row.getCell(7)),
      rowNum,
      cDate: cellToIsoDate(row.getCell(3)),
    };
    rows.push(raw);
  });
  // Strip trailing completely-empty rows
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (!last.A && !last.B && !last.C && !last.D && !last.E && !last.F && !last.G) {
      rows.pop();
    } else {
      break;
    }
  }
  return rows;
}

/* ─────────────────────────────────────────────────────────
 * Day grouping
 *   A new day begins on any row where column C has a valid
 *   date. Subsequent rows (until the next dated row) belong
 *   to that day.
 * ────────────────────────────────────────────────────────── */

interface DayBucket {
  date: string;
  dayOfWeek: string;
  city: string;
  rows: RawRow[];
}

function groupByDay(rows: RawRow[]): DayBucket[] {
  const buckets: DayBucket[] = [];
  let current: DayBucket | null = null;

  for (const row of rows) {
    if (row.cDate) {
      // Start new day
      current = {
        date: row.cDate,
        dayOfWeek: row.B || "",
        city: row.A || "",
        rows: [row],
      };
      buckets.push(current);
    } else if (current) {
      // If this row has a city in col A but no date, treat it as a city update
      // for the same day (e.g. Dec 24 "Berlin/" → "Cotswolds")
      if (row.A && !current.city.includes(row.A)) {
        current.city = current.city ? `${current.city}/${row.A}` : row.A;
      }
      current.rows.push(row);
    }
    // Rows before the first dated row are ignored (header / blank space)
  }
  return buckets;
}

/* ─────────────────────────────────────────────────────────
 * Per-day segment extraction
 * ────────────────────────────────────────────────────────── */

/** Split a day's rows into sub-blocks per column, separated by blank rows in that column. */
function collectColumnBlocks(rows: RawRow[], col: "D" | "E"): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    const value = row[col];
    if (value) {
      current.push(value);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Collect F/G values as individual atomic segments (each non-empty cell = one segment). */
function collectAtomicCells(rows: RawRow[], col: "F" | "G"): string[] {
  return rows.map((r) => r[col]).filter((v): v is string => Boolean(v));
}

/* ── Classification helpers ────────────────────────────── */

const FLIGHT_KEYWORDS = /\b(flight|flt|depart|arriv)\b|\b[A-Z]{3}-[A-Z]{3}\b|\b(BA|AA|UA|DL|LH|AF|KL|EZY|U2|FR|AZ|IB|SAS|SN|VY)\s?\d{1,4}\b/i;
const TRAIN_KEYWORDS = /\btrain\b|\beurostar\b|\bsncf\b|\britail\b/i;
const CAR_RENTAL_KEYWORDS = /\brental car\b|\bcar rental\b|\bpickup rental\b|\breturn rental\b|\bhertz\b|\bavis\b|\bnational car\b|\benterprise\b|\bsixt\b|\beuropcar\b/i;
const CAR_SERVICE_KEYWORDS = /\bchauffeur\b|\btransfer\b|\btaxi\b|\bcab\b|\buber\b|\blyft\b|\bblacklane\b/i;
const CRUISE_KEYWORDS = /\bcruise\b|\bboard ship\b|\bdisembark\b/i;

const HOTEL_KEYWORDS = /\bhotel\b|\binn\b|\bresort\b|\blodge\b|\bsuites?\b|\bhilton\b|\bmarriott\b|\bhyatt\b|\bmoxy\b|\bcitadines\b|\bautograph\b|\bairbnb\b/i;
const STAY_WITH_KEYWORDS = /\bstay with\b/i;

/** Extract HH:MM or HH:MM-HH:MM from a free-form string. */
function extractTimes(text: string): { startTime?: string; endTime?: string } {
  // Normalize unicode dashes
  const normalized = text.replace(/[–—]/g, "-");

  // "19:00" or "1:35PM" or "19:35 --> 12:40" or "12:31-14:50"
  // Try H:MM AM/PM range first
  const range12 = normalized.match(
    /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:-|-->|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (range12) {
    return {
      startTime: to24h(range12[1]!, range12[2]!, range12[3]),
      endTime: to24h(range12[4]!, range12[5]!, range12[6]),
    };
  }

  // Single time "HH:MM [AM/PM]"
  const single = normalized.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (single) {
    return { startTime: to24h(single[1]!, single[2]!, single[3]) };
  }

  // "12pm-7pm" or "6AM-8PM" (no minutes)
  const hourRange = normalized.match(/\b(\d{1,2})\s*(am|pm)\s*-\s*(\d{1,2})\s*(am|pm)\b/i);
  if (hourRange) {
    return {
      startTime: to24h(hourRange[1]!, "00", hourRange[2]),
      endTime: to24h(hourRange[3]!, "00", hourRange[4]),
    };
  }

  return {};
}

function to24h(hh: string, mm: string, ampm?: string): string {
  let h = parseInt(hh, 10);
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === "PM" && h < 12) h += 12;
    if (upper === "AM" && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${mm}`;
}

/** Extract a 5–7 char alphanumeric confirmation code (PNR) from parentheses or bare text. */
function extractConfirmation(text: string): string | undefined {
  // Inside parentheses first: "Flight to Dublin (2LVPEF)"
  const parenMatch = text.match(/\(([A-Z0-9]{5,8})\)/);
  if (parenMatch) return parenMatch[1];

  // Bare 6-char alphanumeric surrounded by word boundaries, not at start of
  // "BA52"-like tokens (3+ letters then 2+ digits). Avoids matching flight numbers.
  const bare = text.match(/\b([A-Z0-9]{6,7})\b/g);
  if (bare) {
    for (const candidate of bare) {
      // Skip pure numeric
      if (/^\d+$/.test(candidate)) continue;
      // Skip airport codes (3 letters)
      if (candidate.length === 3) continue;
      // Skip things that look like flight numbers
      if (/^[A-Z]{2,3}\d+$/.test(candidate)) continue;
      return candidate;
    }
  }
  return undefined;
}

function extractPartySize(text: string): number | undefined {
  // "(2)", "(4)" — party size
  const match = text.match(/\((\d{1,2})\)/);
  if (!match) return undefined;
  const n = parseInt(match[1]!, 10);
  if (n >= 1 && n <= 20) return n;
  return undefined;
}

function hasCreditCardHold(text: string): boolean {
  // "CC" or "CC 12hr" as a word
  return /\bCC\b/.test(text);
}

/** A small IATA airport-code → city lookup for the routes we see most
 *  often. This isn't exhaustive — the inference chain falls back to the
 *  day's city / next day's city when a code isn't in the table. */
const AIRPORT_CODES: Record<string, string> = {
  SEA: "Seattle",
  SFO: "San Francisco",
  LAX: "Los Angeles",
  JFK: "New York",
  EWR: "Newark",
  LGA: "New York",
  BOS: "Boston",
  ORD: "Chicago",
  IAD: "Washington",
  DCA: "Washington",
  MIA: "Miami",
  LHR: "London",
  LGW: "London",
  STN: "London",
  LCY: "London",
  CDG: "Paris",
  ORY: "Paris",
  FRA: "Frankfurt",
  MUC: "Munich",
  BER: "Berlin",
  AMS: "Amsterdam",
  BRU: "Brussels",
  DUB: "Dublin",
  EDI: "Edinburgh",
  MAN: "Manchester",
  ZRH: "Zurich",
  GVA: "Geneva",
  VIE: "Vienna",
  PRG: "Prague",
  BCN: "Barcelona",
  MAD: "Madrid",
  LIS: "Lisbon",
  FCO: "Rome",
  CIA: "Rome",
  MXP: "Milan",
  LIN: "Milan",
  VCE: "Venice",
  NAP: "Naples",
  ATH: "Athens",
  IST: "Istanbul",
  HND: "Tokyo",
  NRT: "Tokyo",
  KIX: "Osaka",
  SYD: "Sydney",
  MEL: "Melbourne",
  YVR: "Vancouver",
  YYZ: "Toronto",
  MEX: "Mexico City",
  GRU: "São Paulo",
  EZE: "Buenos Aires",
  CPT: "Cape Town",
  JNB: "Johannesburg",
  DXB: "Dubai",
  SIN: "Singapore",
  HKG: "Hong Kong",
  PEK: "Beijing",
  PVG: "Shanghai",
};

/**
 * Look for an "XXX-YYY" style airport-code pair in the text. Returns the
 * pair if both look like IATA codes (3 uppercase letters). We check against
 * the lookup table to avoid matching generic 3-letter runs in titles.
 */
function extractAirportCodes(text: string):
  | { from: string; to: string; fromCity?: string; toCity?: string }
  | undefined {
  const match = text.match(/\b([A-Z]{3})\s*[-–→]+\s*([A-Z]{3})\b/);
  if (!match) return undefined;
  const from = match[1]!;
  const to = match[2]!;
  // Only treat as airports if at least one side is a known IATA code — this
  // guards against matching three-letter abbreviations elsewhere in the text.
  if (!(from in AIRPORT_CODES) && !(to in AIRPORT_CODES)) return undefined;
  return {
    from,
    to,
    fromCity: AIRPORT_CODES[from],
    toCity: AIRPORT_CODES[to],
  };
}

/**
 * Pull a trailing destination city out of titles like "Flight to Dublin",
 * "Train to Milan", "Drive to Cotswolds". Returns the captured city or
 * undefined if the pattern doesn't match.
 */
function extractDestinationFromTitle(title: string): string | undefined {
  const match = title.match(/\bto\s+([A-Z][\w'’]*(?:[\s-][A-Z][\w'’]*)*)/);
  return match ? match[1]!.trim() : undefined;
}

function isTransportType(type: SegmentType): boolean {
  return (
    type === "flight" ||
    type === "train" ||
    type === "car_rental" ||
    type === "car_service" ||
    type === "cruise" ||
    type === "other_transport"
  );
}

/* ── Segment builders ──────────────────────────────────── */

function classifyTransport(blockText: string): SegmentType {
  if (CRUISE_KEYWORDS.test(blockText)) return "cruise";
  if (FLIGHT_KEYWORDS.test(blockText)) return "flight";
  if (TRAIN_KEYWORDS.test(blockText)) return "train";
  if (CAR_RENTAL_KEYWORDS.test(blockText)) return "car_rental";
  if (CAR_SERVICE_KEYWORDS.test(blockText)) return "car_service";
  return "other_transport";
}

function buildTransportSegment(lines: string[]): ParsedWorkbookSegment {
  const joined = lines.join(" ");
  const type = classifyTransport(joined);
  const { startTime, endTime } = extractTimes(joined);

  // Title heuristic: use the first line, which is typically the most descriptive
  // ("Flight to Dublin", "Train to Milan", "SEA-LHR", "Rental Car").
  const title = lines[0] || "Transport";

  return {
    type,
    title,
    startTime,
    endTime,
    confirmationCode: extractConfirmation(joined),
    rawText: joined,
  };
}

function buildLodgingSegment(lines: string[]): ParsedWorkbookSegment {
  const joined = lines.join("\n");
  // First line = venue name. Subsequent lines = address / phone / confirmation.
  const [first, ...rest] = lines;
  const venueName = first || "";

  // Address heuristic: first non-empty line after name that contains letters (not pure digits)
  const address = rest.find((l) => /[A-Za-z]/.test(l) && !/^\+?\d[\d\s-]+$/.test(l));
  const phone = rest.find((l) => /^\+?\d[\d\s-]{5,}$/.test(l));

  // Type: default hotel, but override for Airbnb / "Stay with" / car & driver
  let type: SegmentType = "hotel";
  if (STAY_WITH_KEYWORDS.test(venueName)) {
    type = "activity";
  } else if (/car\s*&\s*driver/i.test(venueName)) {
    type = "car_service";
  } else if (!HOTEL_KEYWORDS.test(venueName) && /olympic tours|tours/i.test(venueName)) {
    type = "tour";
  }

  return {
    type,
    title: venueName || "Lodging",
    venueName,
    address,
    phone,
    confirmationCode: extractConfirmation(joined),
    rawText: joined,
  };
}

function buildMealOrActivity(
  text: string,
  defaultMealType: "restaurant_lunch" | "restaurant_dinner",
): ParsedWorkbookSegment {
  const { startTime } = extractTimes(text);
  const partySize = extractPartySize(text);
  const creditCardHold = hasCreditCardHold(text);

  // Clean title — strip party size, CC marker, time tokens
  const title = text
    .replace(/\s*\(\d{1,2}\)\s*/g, " ")
    .replace(/\s*-\s*CC(\s+\d+hr)?\s*/gi, " ")
    .replace(/\s*@\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*/gi, " ")
    .replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim() || text;

  // If the text contains meal-ish keywords, keep as restaurant; otherwise activity.
  // Exception: if it has a party size, it's almost certainly a restaurant reservation.
  const looksLikeActivity = /\b(tour|museum|colosseum|duomo|book of kells|distillery|gallery|park|castle)\b/i.test(text) && partySize === undefined;
  const type: SegmentType = looksLikeActivity ? "activity" : defaultMealType;

  // For restaurants, the cleaned title is the restaurant name — surface it as
  // the venue so the UI can render it as a venue link. Activities keep just
  // a title since "venue" doesn't really apply to e.g. "Colosseum tour".
  const isRestaurant = type === "restaurant_lunch" || type === "restaurant_dinner";

  return {
    type,
    title,
    venueName: isRestaurant && title ? title : undefined,
    startTime,
    partySize,
    creditCardHold: creditCardHold || undefined,
    rawText: text,
  };
}

/* ── Costs sheet parsing ───────────────────────────────── */

/**
 * Detect a currency from an Excel numFmt string. Excel stores the currency
 * symbol in the number format, not the cell value, so a cell showing
 * "€479.00" has raw value 479 and numFmt "[$€-2] #,##0.00". Supports:
 *   "$"…                 → USD
 *   "[$€-2]"…            → EUR
 *   "[$£-809]"…          → GBP
 *   "[$¥-411]"…          → JPY
 */
function currencyFromNumFmt(numFmt: string | undefined): string | undefined {
  if (!numFmt) return undefined;
  if (/"\$"|^\$|[^[]\$/.test(numFmt)) return "USD";
  if (/€/.test(numFmt)) return "EUR";
  if (/£/.test(numFmt)) return "GBP";
  if (/¥/.test(numFmt)) return "JPY";
  // Bracketed locale codes: [$-409] = en-US, [$-809] = en-GB, [$-407] = de-DE
  const loc = numFmt.match(/\[\$-?([0-9a-fA-F]+)\]/);
  if (loc) {
    const code = loc[1]!.toLowerCase();
    if (code === "409") return "USD";
    if (code === "809" || code === "407") return "GBP";
  }
  return undefined;
}

function parseCurrencyCell(text: string): { amount: number; currency: string } | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/,/g, "").trim();

  // Currency-symbol prefix: $1234.56 / €479 / £920 / ¥1000
  const symbolMatch = normalized.match(/^([$€£¥])\s*(\d+(?:\.\d+)?)/);
  if (symbolMatch) {
    const map: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
    return { amount: parseFloat(symbolMatch[2]!), currency: map[symbolMatch[1]!] || "USD" };
  }

  // Currency-code suffix: "1234.56 USD" / "479 EUR"
  const codeMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(USD|EUR|GBP|JPY|CHF|CAD|AUD)/i);
  if (codeMatch) {
    return { amount: parseFloat(codeMatch[1]!), currency: codeMatch[2]!.toUpperCase() };
  }

  // Bare number
  const bare = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return { amount: parseFloat(bare[1]!), currency: "USD" };

  return undefined;
}

/**
 * Parse the Costs sheet. Each new cost entry is marked by a non-empty column A
 * (the category). Amount is in column B — numeric cells carry the currency in
 * their numFmt, while string cells like "£920.00" carry it inline. Column C is
 * free-form details that extend across merged rows.
 */
function parseCostsSheet(ws: ExcelJS.Worksheet): ParsedWorkbookCost[] {
  const costs: ParsedWorkbookCost[] = [];

  interface Pending {
    category: string;
    amount?: number;
    currency?: string;
    detailLines: string[];
  }

  let pending: Pending | null = null;

  const commit = () => {
    if (!pending) return;
    if (pending.amount !== undefined) {
      costs.push({
        category: pending.category,
        amount: pending.amount,
        currency: pending.currency || "USD",
        details: pending.detailLines.filter(Boolean).join("\n") || undefined,
      });
    }
    pending = null;
  };

  // Read each row via direct cell access so we can inspect numFmt and cell type.
  const extractAmount = (
    bCell: ExcelJS.Cell,
  ): { amount: number; currency: string } | undefined => {
    if (bCell.type === ValueType.Merge) return undefined;
    const raw = bCell.value;
    if (raw === null || raw === undefined) return undefined;

    // Numeric cell — currency is in numFmt
    if (typeof raw === "number") {
      const currency = currencyFromNumFmt(bCell.numFmt) || "USD";
      return { amount: raw, currency };
    }

    // Formula with cached numeric result
    if (typeof raw === "object" && raw !== null && "result" in raw) {
      const result = (raw as { result: unknown }).result;
      if (typeof result === "number") {
        const currency = currencyFromNumFmt(bCell.numFmt) || "USD";
        return { amount: result, currency };
      }
    }

    // String cell — parse inline ("£920.00 x 2" → £920, "£416.00" → £416)
    if (typeof raw === "string") return parseCurrencyCell(raw);

    return undefined;
  };

  ws.eachRow({ includeEmpty: true }, (row) => {
    const aCell = row.getCell(1);
    const bCell = row.getCell(2);
    const cCell = row.getCell(3);

    const aText = cellToString(aCell);
    const cText = cellToString(cCell);

    if (aText) {
      // New cost entry
      commit();
      const amt = extractAmount(bCell);
      pending = {
        category: aText,
        amount: amt?.amount,
        currency: amt?.currency,
        detailLines: cText ? [cText] : [],
      };
    } else if (pending) {
      // Continuation row: may add details and/or an additional amount line
      if (cText) pending.detailLines.push(cText);
      if (bCell.type !== ValueType.Merge) {
        const amt = extractAmount(bCell);
        if (amt) {
          if (pending.amount === undefined) {
            pending.amount = amt.amount;
            pending.currency = amt.currency;
          } else {
            // Preserve the additional amount as a details line ("Dresden 259.70")
            pending.detailLines.push(
              `${amt.currency === "USD" ? "$" : amt.currency === "EUR" ? "€" : amt.currency === "GBP" ? "£" : ""}${amt.amount}`,
            );
          }
        }
      }
    }
  });

  commit();
  return costs;
}

/* ── Main importer class ───────────────────────────────── */

export class XlsxTripImporter {
  async parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs accepts a Node Buffer via load()
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      throw new Error(
        `Failed to parse XLSX buffer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const warnings: string[] = [];

    // Locate the Itinerary sheet (case-insensitive), falling back to first sheet
    const itinerarySheet =
      workbook.worksheets.find((s) => /itinerary/i.test(s.name)) ??
      workbook.worksheets[0];

    if (!itinerarySheet) {
      throw new Error("XLSX contains no worksheets");
    }

    const rows = readSheet(itinerarySheet);
    const buckets = groupByDay(rows);

    if (buckets.length === 0) {
      throw new Error(
        "No dated rows found in the Itinerary sheet. Column C must contain dates.",
      );
    }

    const days: ParsedWorkbookDay[] = buckets.map((bucket) => {
      const segments: ParsedWorkbookSegment[] = [];
      const dayCity = bucket.city || "";

      // Column D — transport sub-blocks. Transport doesn't inherit the day's
      // city directly; it gets populated downstream via airport-code lookup
      // and day-to-day context (see enrichTransportCities below).
      const transportBlocks = collectColumnBlocks(bucket.rows, "D");
      for (const block of transportBlocks) {
        segments.push(buildTransportSegment(block));
      }

      // Column E — lodging sub-blocks. Auto-populate the day's city so the
      // hotel card surfaces the location even when the address is missing.
      const lodgingBlocks = collectColumnBlocks(bucket.rows, "E");
      for (const block of lodgingBlocks) {
        const seg = buildLodgingSegment(block);
        if (dayCity) seg.city = dayCity;
        segments.push(seg);
      }

      // Column F — lunch / midday activities (each cell = its own segment)
      for (const cell of collectAtomicCells(bucket.rows, "F")) {
        const seg = buildMealOrActivity(cell, "restaurant_lunch");
        if (dayCity) seg.city = dayCity;
        segments.push(seg);
      }

      // Column G — dinner / evening activities
      for (const cell of collectAtomicCells(bucket.rows, "G")) {
        const seg = buildMealOrActivity(cell, "restaurant_dinner");
        if (dayCity) seg.city = dayCity;
        segments.push(seg);
      }

      return {
        date: bucket.date,
        dayOfWeek: bucket.dayOfWeek || "",
        city: dayCity,
        segments,
      };
    });

    // Ensure days are sorted ascending by date
    days.sort((a, b) => a.date.localeCompare(b.date));

    // Cross-day enrichment passes — must run after the sort so day indices
    // reflect chronological order.
    enrichTransportCities(days);
    inferHotelCheckoutDates(days);

    // Find costs sheet
    const costsSheet = workbook.worksheets.find((s) => /cost/i.test(s.name));
    const costs = costsSheet ? parseCostsSheet(costsSheet) : [];

    // Attach costs to lodging segments by fuzzy city match
    attachCostsToLodging(days, costs);

    const startDate = days[0]!.date;
    const endDate = days[days.length - 1]!.date;

    // Title heuristic — caller passes filename separately for the route; here we
    // return a placeholder that the route can override.
    const title = "Imported Trip";

    return {
      title,
      startDate,
      endDate,
      days,
      costs,
      warnings,
    };
  }
}

/**
 * Populate departure/arrival cities on every transport segment. The
 * inference chain walks from most specific to least:
 *
 *   1. "SEA-LHR" style airport-code pair in the raw text
 *   2. "Flight to Dublin" / "Train to Milan" — capture destination from title
 *   3. Day-to-day context — use the day's city as departure, and the next
 *      day's city (when it differs) as arrival.
 *
 * Existing values (if ever set by a future parser) are always preserved.
 */
function enrichTransportCities(days: ParsedWorkbookDay[]): void {
  // Pre-compute the first city we see on or after each index, which lets
  // same-day transport (e.g. a morning flight when the day's city is already
  // the arrival city) still find a sensible departure from the previous day.
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const prevDay = i > 0 ? days[i - 1] : undefined;
    const nextDay = i + 1 < days.length ? days[i + 1] : undefined;

    for (const seg of day.segments) {
      if (!isTransportType(seg.type)) continue;

      // 1. Airport codes
      const codes = extractAirportCodes(seg.rawText || seg.title);
      if (codes) {
        if (!seg.departureCity) {
          seg.departureCity = codes.fromCity || codes.from;
        }
        if (!seg.arrivalCity) {
          seg.arrivalCity = codes.toCity || codes.to;
        }
      }

      // 2. "to <destination>" in the title
      if (!seg.arrivalCity) {
        const dest = extractDestinationFromTitle(seg.title);
        if (dest) seg.arrivalCity = dest;
      }

      // 3. Day-to-day context
      if (!seg.departureCity) {
        // Prefer this day's city; fall back to prev day's city for early
        // transfers (e.g. an airport transfer on arrival morning).
        seg.departureCity = day.city || prevDay?.city || undefined;
      }
      if (!seg.arrivalCity && nextDay && nextDay.city && nextDay.city !== day.city) {
        seg.arrivalCity = nextDay.city;
      }
    }
  }
}

/**
 * For each hotel segment, infer `endDate` (check-out) from the day of the
 * next hotel with a different venue name. If the hotel is the last one in
 * the trip, use the trip's final day as the check-out date.
 *
 * Same-venue hotels appearing on consecutive days are treated as the same
 * stay — we leave `endDate` alone on the earlier occurrences and only set
 * it once we find a different venue (or reach the end of the trip).
 */
function inferHotelCheckoutDates(days: ParsedWorkbookDay[]): void {
  interface HotelRef {
    day: ParsedWorkbookDay;
    seg: ParsedWorkbookSegment;
  }
  const hotels: HotelRef[] = [];
  for (const day of days) {
    for (const seg of day.segments) {
      if (seg.type === "hotel") hotels.push({ day, seg });
    }
  }

  if (hotels.length === 0 || days.length === 0) return;
  const tripEnd = days[days.length - 1]!.date;

  for (let i = 0; i < hotels.length; i++) {
    const current = hotels[i]!;
    if (current.seg.endDate) continue; // already set — respect it

    // Find the next hotel with a different venueName. A same-venue hotel on
    // a later day is a continuation of the same stay, not a new booking.
    const currentVenue = (current.seg.venueName || current.seg.title || "")
      .trim()
      .toLowerCase();
    let nextDifferent: HotelRef | undefined;
    for (let j = i + 1; j < hotels.length; j++) {
      const candidateVenue = (hotels[j]!.seg.venueName || hotels[j]!.seg.title || "")
        .trim()
        .toLowerCase();
      if (candidateVenue !== currentVenue) {
        nextDifferent = hotels[j];
        break;
      }
    }

    if (nextDifferent) {
      current.seg.endDate = nextDifferent.day.date;
    } else {
      // Last hotel of the trip — check out on the final day.
      current.seg.endDate = tripEnd;
    }
  }
}

/**
 * Walk the Costs sheet rows and, for each "Hotel in <City>" entry, find a
 * lodging segment in that city and attach the cost. This is a best-effort
 * match — misses are harmless (the cost still appears in the returned
 * `costs` array and can be displayed separately if the caller wants).
 */
function attachCostsToLodging(
  days: ParsedWorkbookDay[],
  costs: ParsedWorkbookCost[],
): void {
  for (const cost of costs) {
    const hotelMatch = cost.category.match(/^Hotel in ([A-Za-z /]+?)(?:\s*\(|$)/i);
    if (!hotelMatch) continue;
    const city = hotelMatch[1]!.trim().toLowerCase();

    for (const day of days) {
      if (!day.city.toLowerCase().includes(city)) continue;
      const lodging = day.segments.find(
        (s) => s.type === "hotel" && !s.cost,
      );
      if (lodging) {
        lodging.cost = {
          amount: cost.amount,
          currency: cost.currency,
          details: cost.details,
        };
        break; // attach to first matching day only
      }
    }
  }
}
