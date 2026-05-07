"use client";

import { useState } from "react";
import type { Segment, Trip, TripDay } from "@travel-app/shared";
import { formatFlightEndpoint } from "@travel-app/shared";
import { cn } from "@/lib/utils";
import {
  CATEGORY_TOKEN,
  extractHotels,
  getTimelineCategory,
  sortByTime,
  type HotelBar,
  type TimelineCategory,
} from "@/components/timeline-shared";
import { MobileSegmentDetailSheet } from "./mobile-segment-detail-sheet";
import { SEGMENT_CONFIG } from "./mobile-segment-config";

// ── Visual helpers ───────────────────────────────────────────

function pillStyle(cat: TimelineCategory): React.CSSProperties {
  const t = CATEGORY_TOKEN[cat];
  return {
    backgroundColor: `var(--cat-${t}-rail)`,
    color: "#fff",
  };
}

function cellBgStyle(cat: TimelineCategory): React.CSSProperties {
  const t = CATEGORY_TOKEN[cat];
  return {
    backgroundColor: `color-mix(in oklab, var(--cat-${t}-bg) 30%, transparent)`,
  };
}

function dayShort(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function segmentPillLabel(segment: Segment): string {
  // Flights with IATA codes get the compact "JFK → NRT" form so the
  // timeline pill stays scannable even at mobile widths. Other types
  // fall back to whatever the user typed.
  if (segment.type === "flight") {
    const dep = formatFlightEndpoint(
      segment.departureAirport,
      segment.departureCity,
      "compact",
    );
    const arr = formatFlightEndpoint(
      segment.arrivalAirport,
      segment.arrivalCity,
      "compact",
    );
    if (dep && arr) return `${dep} → ${arr}`;
  }
  return segment.title;
}

// ── Sub-components ───────────────────────────────────────────

function Pill({
  segment,
  showIcon,
  onSelect,
}: {
  segment: Segment;
  showIcon: boolean;
  onSelect: (segment: Segment) => void;
}): React.JSX.Element {
  const cat = getTimelineCategory(segment.type);
  const cfg = SEGMENT_CONFIG[segment.type] ?? SEGMENT_CONFIG.activity;
  const Icon = cfg.icon;
  const timeStr = segment.startTime
    ? segment.endTime
      ? `${segment.startTime}–${segment.endTime}`
      : segment.startTime
    : null;
  const label = segmentPillLabel(segment);
  return (
    <button
      type="button"
      onClick={() => onSelect(segment)}
      className="mb-1 block w-full rounded-md px-1.5 py-1 text-left text-[11px] leading-tight transition-transform last:mb-0 active:scale-[0.98]"
      style={pillStyle(cat)}
    >
      <div className="flex items-start gap-1">
        {showIcon && <Icon className="mt-0.5 h-2.5 w-2.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{label}</div>
          {timeStr && (
            <div className="text-[10px] opacity-80">{timeStr}</div>
          )}
        </div>
      </div>
    </button>
  );
}

function RowLabel({
  icon: Icon,
  name,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
}): React.JSX.Element {
  return (
    <div
      title={name}
      className="sticky left-0 z-10 flex items-center justify-center gap-1 border-b border-r border-border/60 bg-card px-1.5 py-2 landscape:justify-start landscape:px-3"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {/* Label text is hidden in portrait (sticky col is too narrow) and
          revealed in landscape where the column gets more breathing room. */}
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground landscape:inline">
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
  onSelect,
}: {
  days: readonly TripDay[];
  category: TimelineCategory;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: (segment: Segment) => void;
}): React.JSX.Element {
  return (
    <>
      <RowLabel icon={icon} name={label} />
      {days.map((day) => {
        const segs = sortByTime(
          day.segments.filter((s) => getTimelineCategory(s.type) === category),
        );
        return (
          <div
            key={day.date}
            className="min-h-12 border-b border-r border-border/60 p-1"
            style={cellBgStyle(category)}
          >
            {segs.length === 0 ? (
              <div className="pt-2 text-center text-[10px] text-muted-foreground/40">
                —
              </div>
            ) : (
              segs.map((s) => (
                <Pill
                  key={s.id}
                  segment={s}
                  showIcon={false}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

function HotelRow({
  days,
  hotels,
  onSelect,
}: {
  days: readonly TripDay[];
  hotels: HotelBar[];
  onSelect: (segment: Segment) => void;
}): React.JSX.Element {
  // Same clamping as desktop's HotelRow — sort by start, fill empty cells
  // before each bar, place a `gridColumn: span N` pill for the bar, and
  // emit a `Math.min` clamp so out-of-range checkouts can't push the
  // row past `days.length` cells (which would scramble the grid).
  const sorted = [...hotels].sort((a, b) => a.startDayIdx - b.startDayIdx);
  const cells: React.ReactNode[] = [];
  let idx = 0;
  const rowBg = cellBgStyle("hotel");
  const lodgingPill: React.CSSProperties = pillStyle("hotel");

  sorted.forEach((hotel) => {
    const start = Math.max(hotel.startDayIdx, idx);
    const end = Math.min(
      Math.max(hotel.endDayIdx, start),
      days.length - 1,
    );
    const span = end - start + 1;
    if (span <= 0) return;

    while (idx < start) {
      cells.push(
        <div
          key={`he-${idx}`}
          className="min-h-12 border-b border-r border-border/60"
          style={rowBg}
        />,
      );
      idx++;
    }
    const h = hotel.segment;
    const name = h.venueName ?? h.title;
    cells.push(
      <button
        type="button"
        key={h.id}
        onClick={() => onSelect(h)}
        className="flex min-h-12 items-center border-b border-r border-border/60 p-1 transition-transform active:scale-[0.99]"
        style={{ ...rowBg, gridColumn: `span ${span}` }}
      >
        <div
          className="flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={lodgingPill}
        >
          <span className="truncate">{name}</span>
          {span > 1 && (
            <span className="ml-auto pl-1 text-[10px] font-normal opacity-80">
              {span}n
            </span>
          )}
        </div>
      </button>,
    );
    idx = end + 1;
  });

  while (idx < days.length) {
    cells.push(
      <div
        key={`he-${idx}`}
        className="min-h-12 border-b border-r border-border/60"
        style={rowBg}
      />,
    );
    idx++;
  }

  const HotelIcon = SEGMENT_CONFIG.hotel.icon;
  return (
    <>
      <RowLabel icon={HotelIcon} name="Lodging" />
      {cells}
    </>
  );
}

// ── Main export ──────────────────────────────────────────────

/**
 * Mobile counterpart to desktop `TimelineView` — same swimlane / chrono
 * grid in a frame tuned for thumb scrolling and rotation.
 *
 * Layout:
 * - CSS grid: row = swimlane (or single "All events" in chrono mode),
 *   column = day. Sticky left label column + sticky day-header row.
 * - Day-column min width is **6rem** (vs 7.5rem on desktop) so a
 *   390px portrait viewport fits ~3 columns and an 800px landscape
 *   one fits ~6+ — no JS orientation listener, the grid just reflows
 *   when the parent `MobileFrame` widens.
 * - Hotel multi-day bars span their day range via `gridColumn: span N`
 *   (same logic as desktop, shared via `extractHotels`).
 *
 * Tap a pill → `MobileSegmentDetailSheet` opens with the same shape
 * the carousel uses, so users don't learn two interaction models.
 */
export function MobileTimelineView({
  trip,
}: {
  trip: Trip;
}): React.JSX.Element {
  const [mode, setMode] = useState<"grouped" | "chrono">("grouped");
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const { days } = trip;
  const hotels = extractHotels(days);

  // Find the day containing the selected segment so the detail sheet
  // can show its date — same lookup the carousel does.
  const segmentDate = selectedSegment
    ? days.find((d) =>
        d.segments.some((s) => s.id === selectedSegment.id),
      )?.date
    : undefined;

  // Mobile-tuned column widths. Tuned so a 390px portrait phone fits
  // exactly 3 day columns and an 800px landscape phone fits 6 columns.
  // Fixed widths (not `minmax(...,1fr)`) so the grid doesn't balloon
  // when a pill's intrinsic content is wider than the column — that
  // would defeat `truncate` and force horizontal scroll inside what
  // should be a snug grid. The wrapper's `overflow-auto` handles the
  // scroll when there are more days than fit.
  //
  //   Portrait 390px: 3rem label + 3 × 7rem cols = 384px < 390 ✓
  //   Landscape 800px: 5rem label + 6 × 7rem cols = 752px < 800 ✓
  const gridCols =
    "var(--m-timeline-label-col, 3rem) " +
    `repeat(${days.length}, var(--m-timeline-day-min, 7rem))`;

  if (days.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <p className="rounded-xl border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground">
          No days planned yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden landscape:[--m-timeline-label-col:5rem]">
      {/* Mode toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background px-3 py-2">
        <p className="text-kicker font-semibold text-muted-foreground">
          Timeline
        </p>
        <div className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {(["grouped", "chrono"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition-all",
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {m === "grouped" ? "By type" : "Chrono"}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable timeline grid. Width comes from the explicit
          column widths in `gridCols`; no `width: max-content` so a
          pill with long text truncates inside its column instead of
          stretching the column to fit. */}
      <div className="flex-1 overflow-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: gridCols }}
        >
          {/* Day header row — sticky to the top so vertical scroll keeps it visible. */}
          <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted/60" />
          {days.map((day) => (
            <div
              key={day.date}
              className="sticky top-0 z-20 border-b border-r border-border/60 bg-muted/60 px-1 py-1.5 text-center"
            >
              <div className="text-[11px] font-bold text-foreground">
                {day.dayOfWeek}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {dayShort(day.date)}
              </div>
              {day.city && (
                <div className="mx-auto mt-0.5 max-w-[5rem] truncate text-[10px] font-medium text-muted-foreground">
                  {day.city}
                </div>
              )}
            </div>
          ))}

          {mode === "grouped" ? (
            <>
              <TypeRow
                days={days}
                category="transport"
                icon={SEGMENT_CONFIG.flight.icon}
                label="Transport"
                onSelect={setSelectedSegment}
              />
              <HotelRow
                days={days}
                hotels={hotels}
                onSelect={setSelectedSegment}
              />
              <TypeRow
                days={days}
                category="activity"
                icon={SEGMENT_CONFIG.activity.icon}
                label="Activities"
                onSelect={setSelectedSegment}
              />
              <TypeRow
                days={days}
                category="dining"
                icon={SEGMENT_CONFIG.restaurant_dinner.icon}
                label="Dining"
                onSelect={setSelectedSegment}
              />
            </>
          ) : (
            <>
              <HotelRow
                days={days}
                hotels={hotels}
                onSelect={setSelectedSegment}
              />
              <RowLabel icon={SEGMENT_CONFIG.activity.icon} name="All" />
              {days.map((day) => {
                const segs = sortByTime(
                  day.segments.filter((s) => s.type !== "hotel"),
                );
                return (
                  <div
                    key={day.date}
                    className="min-h-12 border-b border-r border-border/60 bg-card p-1"
                  >
                    {segs.length === 0 ? (
                      <div className="pt-2 text-center text-[10px] text-muted-foreground/40">
                        —
                      </div>
                    ) : (
                      segs.map((s) => (
                        <Pill
                          key={s.id}
                          segment={s}
                          showIcon
                          onSelect={setSelectedSegment}
                        />
                      ))
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <MobileSegmentDetailSheet
        segment={selectedSegment}
        date={segmentDate}
        onClose={() => setSelectedSegment(null)}
      />
    </div>
  );
}
