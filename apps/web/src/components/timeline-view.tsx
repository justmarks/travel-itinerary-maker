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

const PILL_STYLES: Record<Category, string> = {
  transport: "bg-blue-50 text-blue-700 border border-blue-200",
  hotel:     "bg-amber-50 text-amber-800 border border-amber-200",
  activity:  "bg-emerald-50 text-emerald-700 border border-emerald-200",
  dining:    "bg-rose-50 text-rose-700 border border-rose-200",
};

const CELL_BG: Record<Category, string> = {
  transport: "bg-blue-50/30",
  hotel:     "bg-amber-50/20",
  activity:  "bg-emerald-50/30",
  dining:    "bg-rose-50/30",
};

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
    <div className={cn("rounded-md px-2 py-1.5 text-xs leading-tight mb-1 last:mb-0", PILL_STYLES[cat])}>
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
      className="sticky left-0 z-10 bg-white border-r border-gray-200 border-b border-gray-100 px-2 sm:px-3 py-2.5 flex items-center sm:items-start justify-center sm:justify-start gap-1.5"
    >
      <span className="text-sm leading-none sm:mt-0.5">{icon}</span>
      <span className="hidden sm:inline text-[11px] font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
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
            className={cn(
              "border-b border-gray-100 border-r border-gray-100 p-1.5 min-h-12",
              CELL_BG[category],
            )}
          >
            {segs.length === 0 ? (
              <div className="text-[10px] text-gray-300 text-center pt-2.5">—</div>
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
          className="bg-amber-50/20 border-b border-gray-100 border-r border-gray-100 min-h-14"
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
        className="bg-amber-50/20 border-b border-gray-100 border-r border-gray-100 p-2 min-h-14 flex items-center"
        style={{ gridColumn: `span ${span}` }}
      >
        <div className="flex items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 w-full min-w-0">
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
        className="bg-amber-50/20 border-b border-gray-100 border-r border-gray-100 min-h-14"
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
  const items = [
    { label: "Transport", bg: "bg-blue-100",    border: "border-blue-200"    },
    { label: "Lodging",   bg: "bg-amber-100",   border: "border-amber-200"   },
    { label: "Activity",  bg: "bg-emerald-100", border: "border-emerald-200" },
    { label: "Dining",    bg: "bg-rose-100",    border: "border-rose-200"    },
  ];
  return (
    <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-gray-100 bg-gray-50">
      {items.map(({ label, bg, border }) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
          <div className={cn("w-2.5 h-2.5 rounded-sm border", bg, border)} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────

export function TimelineView({ trip }: { trip: Trip }) {
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
      <div className="rounded-xl border border-gray-200 bg-white px-8 py-16 text-center text-sm text-gray-400">
        No days planned yet.
      </div>
    );
  }

  return (
    <div>
      {/* Toggle — hidden when printing */}
      <div className="flex justify-end mb-3 print-hidden">
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {(["grouped", "chrono"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3.5 py-1.5 text-sm font-medium rounded-md transition-all",
                mode === m
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              )}
            >
              {m === "grouped" ? "Group by type" : "Chronological"}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline card */}
      <div className="timeline-card bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto timeline-scroll">
          <div
            className="grid timeline-grid"
            style={{ gridTemplateColumns: gridCols, width: "100%" }}
          >
            {/* Day header row */}
            <div className="sticky left-0 z-20 bg-gray-50 border-b border-gray-200 border-r border-gray-200" />
            {days.map((day) => (
              <div
                key={day.date}
                className="bg-gray-50 border-b border-gray-200 border-r border-gray-100 px-1.5 sm:px-3 py-2.5 text-center"
              >
                <div className="text-[13px] font-bold text-gray-900">{day.dayOfWeek}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 font-medium truncate max-w-[4.5rem] sm:max-w-[7rem] mx-auto">
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
                      className="border-b border-gray-100 border-r border-gray-100 p-1.5 min-h-12 bg-white"
                    >
                      {segs.length === 0 ? (
                        <div className="text-[10px] text-gray-300 text-center pt-2.5">—</div>
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
        <Legend />
      </div>
    </div>
  );
}
