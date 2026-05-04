"use client";

import { useState } from "react";
import type { Trip, TripDay, Segment, SegmentType } from "@travel-app/shared";
import { formatFlightEndpoint } from "@travel-app/shared";
import { cn } from "@/lib/utils";

// ── Category helpers ──────────────────────────────────────────

type Category = "transport" | "hotel" | "activity" | "dining";

const TRANSPORT_TYPES = new Set<SegmentType>([
  "flight", "train", "car_rental", "car_service", "other_transport",
]);
const ACTIVITY_TYPES = new Set<SegmentType>(["activity", "tour", "cruise", "show"]);
const DINING_TYPES = new Set<SegmentType>([
  "restaurant_breakfast", "restaurant_brunch", "restaurant_lunch", "restaurant_dinner",
]);

function getCategory(type: SegmentType): Category {
  if (TRANSPORT_TYPES.has(type)) return "transport";
  if (type === "hotel")          return "hotel";
  if (ACTIVITY_TYPES.has(type))  return "activity";
  if (DINING_TYPES.has(type))    return "dining";
  return "activity";
}

const SEGMENT_ICON: Record<SegmentType, string> = {
  flight:               "✈",
  train:                "🚄",
  car_rental:           "🚗",
  car_service:          "🚘",
  other_transport:      "🚌",
  hotel:                "🏨",
  activity:             "🎯",
  tour:                 "🗺️",
  cruise:               "🚢",
  show:                 "🎭",
  restaurant_breakfast: "☀️",
  restaurant_brunch:    "🥞",
  restaurant_lunch:     "🥗",
  restaurant_dinner:    "🍽️",
};

// Pill and cell tints come from the four `--cat-*` design-system tokens
// (see `globals.css`). The Timeline `Category` type uses the legacy key
// `hotel` for the lodging category; map it to the `lodging` token name
// at the boundary so the rest of the file stays unchanged.
const CATEGORY_TOKEN: Record<Category, string> = {
  transport: "transport",
  hotel:     "lodging",
  activity:  "activity",
  dining:    "dining",
};

function pillStyle(cat: Category): React.CSSProperties {
  const t = CATEGORY_TOKEN[cat];
  return {
    backgroundColor: `var(--cat-${t}-bg)`,
    color: `var(--cat-${t}-fg)`,
    borderColor: `var(--cat-${t}-rail)`,
    borderWidth: "1px",
    borderStyle: "solid",
  };
}

function cellBgStyle(cat: Category): React.CSSProperties {
  // Cells use a quarter-strength wash of the pill background so the row
  // is hue-tinted without overpowering the pills sitting on top.
  const t = CATEGORY_TOKEN[cat];
  return {
    backgroundColor: `color-mix(in oklab, var(--cat-${t}-bg) 30%, transparent)`,
  };
}

// ── Data helpers ──────────────────────────────────────────────

function sortByTime(segs: Segment[]): Segment[] {
  return [...segs].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

interface HotelBar {
  segment: Segment;
  startDayIdx: number;
  endDayIdx: number;
}

function extractHotels(days: TripDay[]): HotelBar[] {
  const bars: HotelBar[] = [];
  days.forEach((day, dayIdx) => {
    day.segments.filter((s) => s.type === "hotel").forEach((s) => {
      let endDayIdx = dayIdx;
      if (s.endDate) {
        const found = days.findIndex((d) => d.date === s.endDate);
        // endDate is checkout day; bar covers up to the night before.
        // If endDate is not in the trip range, fall back to a single-day bar
        // rather than extending across the whole trip — that would overlap
        // later hotels and scramble the grid.
        if (found > 0) endDayIdx = found - 1;
      }
      bars.push({ segment: s, startDayIdx: dayIdx, endDayIdx });
    });
  });
  return bars;
}

// ── Sub-components ────────────────────────────────────────────

function Pill({ segment, showIcon }: { segment: Segment; showIcon: boolean }) {
  const cat = getCategory(segment.type);
  const timeStr = segment.startTime
    ? segment.endTime
      ? `${segment.startTime}–${segment.endTime}`
      : segment.startTime
    : null;
  // Flights with IATA codes get the compact "JFK → NRT" form regardless of
  // what the user typed in the title — keeps the timeline consistent with
  // the other views and avoids bare city names crammed into a tiny pill.
  const label = segmentPillLabel(segment);
  return (
    <div
      className="rounded-md px-2 py-1.5 text-xs leading-tight mb-1 last:mb-0"
      style={pillStyle(cat)}
    >
      <div className="font-semibold truncate">
        {showIcon && <span className="mr-1">{SEGMENT_ICON[segment.type]}</span>}
        {label}
      </div>
      {timeStr && <div className="opacity-70 text-[10.5px] mt-px">{timeStr}</div>}
    </div>
  );
}

function segmentPillLabel(segment: Segment): string {
  if (segment.type === "flight") {
    const dep = formatFlightEndpoint(segment.departureAirport, segment.departureCity, "compact");
    const arr = formatFlightEndpoint(segment.arrivalAirport, segment.arrivalCity, "compact");
    if (dep && arr) return `${dep} → ${arr}`;
  }
  return segment.title;
}

function RowLabel({ icon, name }: { icon: string; name: string }) {
  return (
    <div
      title={name}
      className="sticky left-0 z-10 bg-card border-r border-border border-b border-border/60 px-2 sm:px-3 py-2.5 flex items-center sm:items-start justify-center sm:justify-start gap-1.5"
    >
      <span className="text-sm leading-none sm:mt-0.5">{icon}</span>
      <span className="hidden sm:inline text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
        {name}
      </span>
    </div>
  );
}

function TypeRow({
  days,
  category,
  icon,
  label,
}: {
  days: TripDay[];
  category: Category;
  icon: string;
  label: string;
}) {
  return (
    <>
      <RowLabel icon={icon} name={label} />
      {days.map((day) => {
        const segs = sortByTime(day.segments.filter((s) => getCategory(s.type) === category));
        return (
          <div
            key={day.date}
            className="border-b border-border/60 border-r border-border/60 p-1.5 min-h-12"
            style={cellBgStyle(category)}
          >
            {segs.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/40 text-center pt-2.5">—</div>
            ) : (
              segs.map((s) => <Pill key={s.id} segment={s} showIcon={false} />)
            )}
          </div>
        );
      })}
    </>
  );
}

function HotelRow({ days, hotels }: { days: TripDay[]; hotels: HotelBar[] }) {
  const sorted = [...hotels].sort((a, b) => a.startDayIdx - b.startDayIdx);
  const cells: React.ReactNode[] = [];
  let idx = 0;

  // Lodging row tints are derived from the lodging category token so the
  // hotel band stays in sync with the legend swatch and Map pin color.
  const rowBg = cellBgStyle("hotel");
  const pillStyleLodging: React.CSSProperties = pillStyle("hotel");

  sorted.forEach((hotel) => {
    // Clamp so overlapping/out-of-range hotels cannot push this row past
    // `days.length` cells — that would wrap and misalign every row below it.
    const start = Math.max(hotel.startDayIdx, idx);
    const end = Math.min(Math.max(hotel.endDayIdx, start), days.length - 1);
    const span = end - start + 1;
    if (span <= 0) return;

    // Empty cells before this hotel
    while (idx < start) {
      cells.push(
        <div
          key={`he-${idx}`}
          className="border-b border-border/60 border-r border-border/60 min-h-14"
          style={rowBg}
        />,
      );
      idx++;
    }
    // Spanning hotel cell
    const h = hotel.segment;
    const name = h.venueName ?? h.title;
    cells.push(
      <div
        key={h.id}
        className="border-b border-border/60 border-r border-border/60 p-2 min-h-14 flex items-center"
        style={{ ...rowBg, gridColumn: `span ${span}` }}
      >
        <div
          className="flex items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-xs font-semibold w-full min-w-0"
          style={pillStyleLodging}
        >
          <span className="hidden sm:inline shrink-0">🏨</span>
          <span className="truncate">{name}</span>
          <span className="hidden sm:inline ml-auto pl-2 shrink-0 font-normal opacity-70 text-[10.5px]">
            {span} night{span !== 1 ? "s" : ""}
          </span>
        </div>
      </div>,
    );
    idx = end + 1;
  });

  // Empty cells after last hotel
  while (idx < days.length) {
    cells.push(
      <div
        key={`he-${idx}`}
        className="border-b border-border/60 border-r border-border/60 min-h-14"
        style={rowBg}
      />,
    );
    idx++;
  }

  return (
    <>
      <RowLabel icon="🏨" name="Lodging" />
      {cells}
    </>
  );
}

function Legend() {
  // Order matches the grouped-by-type rows below: Transport / Lodging /
  // Activity / Dining. Mirrors the order on the Map view's legend so a
  // user can scan either view and find the same swatch in the same slot.
  // Swatches reference the four `--cat-*` design-system tokens so the
  // legend, pill backgrounds, and map pins all share one source of truth.
  const items: { label: string; token: string }[] = [
    { label: "Transport", token: "transport" },
    { label: "Lodging",   token: "lodging" },
    { label: "Activity",  token: "activity" },
    { label: "Dining",    token: "dining" },
  ];
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(({ label, token }) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: `var(--cat-${token}-fg)` }}
          />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────

export function TimelineView({ trip }: { trip: Trip }): React.JSX.Element {
  const [mode, setMode] = useState<"grouped" | "chrono">("grouped");
  const { days } = trip;
  const hotels = extractHotels(days);

  // Column widths are driven by CSS custom properties so print media can shrink
  // the per-day minimum to 0 (cells share page width equally) without having
  // to rewrite the whole template from a media query. See globals.css.
  const gridCols =
    "var(--timeline-label-col, 8rem) " +
    `repeat(${days.length}, minmax(var(--timeline-day-min, 7.5rem), 1fr))`;

  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-8 py-16 text-center text-sm text-muted-foreground">
        No days planned yet.
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar — legend on the left (matches the Map view layout), the
          group-by-type / chronological toggle on the right. Hidden when
          printing so the timeline owns the full page. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 print-hidden">
        <Legend />
        <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
          {(["grouped", "chrono"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3.5 py-1.5 text-sm font-medium rounded-md transition-all",
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "grouped" ? "Group by type" : "Chronological"}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline card */}
      <div className="timeline-card bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto timeline-scroll">
          <div
            className="grid timeline-grid"
            style={{ gridTemplateColumns: gridCols, width: "100%" }}
          >
            {/* Day header row */}
            <div className="sticky left-0 z-20 bg-muted/40 border-b border-border border-r border-border" />
            {days.map((day) => (
              <div
                key={day.date}
                className="bg-muted/40 border-b border-border border-r border-border/60 px-1.5 sm:px-3 py-2.5 text-center"
              >
                <div className="text-[13px] font-bold text-foreground">{day.dayOfWeek}</div>
                <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                  {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 font-medium truncate max-w-[4.5rem] sm:max-w-[7rem] mx-auto">
                  {day.city}
                </div>
              </div>
            ))}

            {mode === "grouped" ? (
              <>
                <TypeRow days={days} category="transport" icon="✈"   label="Transport"  />
                <HotelRow days={days} hotels={hotels} />
                <TypeRow days={days} category="activity"  icon="🎯"  label="Activities" />
                <TypeRow days={days} category="dining"    icon="🍽️" label="Dining"      />
              </>
            ) : (
              <>
                <HotelRow days={days} hotels={hotels} />
                <RowLabel icon="🗓" name="All events" />
                {days.map((day) => {
                  const segs = sortByTime(day.segments.filter((s) => s.type !== "hotel"));
                  return (
                    <div
                      key={day.date}
                      className="border-b border-border/60 border-r border-border/60 p-1.5 min-h-12 bg-card"
                    >
                      {segs.length === 0 ? (
                        <div className="text-[10px] text-muted-foreground/40 text-center pt-2.5">—</div>
                      ) : (
                        segs.map((s) => <Pill key={s.id} segment={s} showIcon />)
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
