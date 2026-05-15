"use client";

import React, { useState } from "react";
import type { Segment, Trip, TripDay } from "@itinly/shared";
import { formatFlightEndpoint } from "@itinly/shared";
import { cn } from "@/lib/utils";
import {
  BAND_TYPES,
  CATEGORY_TOKEN,
  extractHotels,
  extractRentals,
  getTimelineCategory,
  packIntoTracks,
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
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      {/* Label text is hidden in portrait (sticky col is too narrow) and
          revealed in landscape where the column gets more breathing room.
          `whitespace-nowrap` is the guard against the column boundary
          breaking "ACTIVITIES" into a vertical letter-stack when the
          available text width drops below the word's intrinsic size. */}
      <span className="hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground landscape:inline">
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
        // Filter out band types (hotel / cruise / car_rental) so they
        // don't double-render as both a band AND a per-day pill.
        const segs = sortByTime(
          day.segments.filter(
            (s) =>
              getTimelineCategory(s.type) === category &&
              !BAND_TYPES.has(s.type),
          ),
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

/**
 * Mobile Transport lane — compound row that puts per-day flight /
 * transfer pills AND any rental bands in the SAME visual row, so the
 * Transport lane reads as one row instead of pills above, band
 * below. Same approach as desktop's `TransportLane`: nested grid with
 * EVERY child explicitly placed on `gridRow: 1` so the band overlap
 * doesn't push cells onto a second row.
 */
function TransportLane({
  days,
  gridCols,
  rentals,
  onSelect,
}: {
  days: readonly TripDay[];
  gridCols: string;
  rentals: HotelBar[];
  onSelect: (segment: Segment) => void;
}): React.JSX.Element {
  const tracks = packIntoTracks(rentals);
  const numBandRows = tracks.length;
  const rowBg = cellBgStyle("transport");
  const transportPill: React.CSSProperties = pillStyle("transport");
  const bandReservedHeight =
    numBandRows > 0 ? `calc(${numBandRows} * 1.75rem + 0.25rem)` : "0px";
  const FlightIcon = SEGMENT_CONFIG.flight.icon;

  return (
    <div
      className="grid"
      style={{
        gridColumn: "1 / -1",
        gridTemplateColumns: gridCols,
      }}
    >
      <div style={{ gridRow: 1, gridColumn: 1 }}>
        <RowLabel icon={FlightIcon} name="Transport" />
      </div>
      {days.map((day, dayIdx) => {
        const segs = sortByTime(
          day.segments.filter(
            (s) =>
              getTimelineCategory(s.type) === "transport" &&
              !BAND_TYPES.has(s.type),
          ),
        );
        return (
          <div
            key={day.date}
            style={{
              gridRow: 1,
              gridColumn: dayIdx + 2,
              ...rowBg,
              paddingBottom: bandReservedHeight,
            }}
            className="min-h-12 border-b border-r border-border/60 p-1 flex flex-col"
          >
            {segs.length === 0 ? (
              <div className="pt-2 text-center text-[10px] text-muted-foreground/40">
                —
              </div>
            ) : (
              segs.map((s) => (
                <Pill key={s.id} segment={s} showIcon={false} onSelect={onSelect} />
              ))
            )}
          </div>
        );
      })}
      {tracks.map((track, trackIdx) =>
        track.map((bar) => {
          const start = bar.startDayIdx;
          const end = Math.min(bar.endDayIdx, days.length - 1);
          const span = end - start + 1;
          if (span <= 0) return null;
          const { name, unitSuffix } = bandCosmetics(bar.segment);
          return (
            <button
              type="button"
              key={`rental-${bar.segment.id}`}
              onClick={() => onSelect(bar.segment)}
              style={{
                gridColumn: `${start + 2} / span ${span}`,
                gridRow: 1,
                alignSelf: "end",
                marginBottom: `calc(${numBandRows - 1 - trackIdx} * 1.75rem + 0.25rem)`,
                ...transportPill,
              }}
              className="mx-1 mb-1 flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-semibold min-w-0 transition-transform active:scale-[0.99]"
            >
              <span className="truncate">{name}</span>
              {span > 1 && (
                <span className="ml-auto pl-1 text-[10px] font-normal opacity-80">
                  {span}{unitSuffix}
                </span>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}

/** Per-bar name + unit suffix for the mobile band pill. */
function bandCosmetics(s: Segment): { name: string; unitSuffix: string } {
  if (s.type === "cruise") {
    return { name: s.shipName ?? s.title, unitSuffix: "d" };
  }
  if (s.type === "car_rental") {
    return { name: s.title, unitSuffix: "d" };
  }
  return { name: s.venueName ?? s.title, unitSuffix: "n" };
}

/**
 * Mobile band-row component. Lodging (hotel + cruise) and Transport
 * (car rental) bands share the same rendering shape — one row per
 * track from `packIntoTracks`. `rowLabel` is shown on the first
 * track only; subsequent tracks emit an empty sticky placeholder.
 * Omit `rowLabel` to render label-less rows (e.g. rental bands as
 * additional sub-rows under a Transport TypeRow that already shows
 * the label).
 */
function BandRows({
  days,
  bars,
  category,
  keyPrefix,
  rowLabel,
  onSelect,
}: {
  days: readonly TripDay[];
  bars: HotelBar[];
  category: TimelineCategory;
  keyPrefix: string;
  rowLabel?: {
    icon: React.ComponentType<{ className?: string }>;
    name: string;
  };
  onSelect: (segment: Segment) => void;
}): React.JSX.Element | null {
  const rowBg = cellBgStyle(category);
  const bandPill: React.CSSProperties = pillStyle(category);
  const tracks = packIntoTracks(bars);

  if (tracks.length === 0) {
    if (!rowLabel) return null;
    return (
      <>
        <RowLabel icon={rowLabel.icon} name={rowLabel.name} />
        {days.map((_, i) => (
          <div
            key={`${keyPrefix}-empty-${i}`}
            className="min-h-12 border-b border-r border-border/60"
            style={rowBg}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {tracks.map((track, trackIdx) => {
        const cells: React.ReactNode[] = [];
        let idx = 0;
        track.forEach((bar) => {
          const start = Math.max(bar.startDayIdx, idx);
          const end = Math.min(
            Math.max(bar.endDayIdx, start),
            days.length - 1,
          );
          const span = end - start + 1;
          if (span <= 0) return;

          while (idx < start) {
            cells.push(
              <div
                key={`${keyPrefix}-${trackIdx}-${idx}`}
                className="min-h-12 border-b border-r border-border/60"
                style={rowBg}
              />,
            );
            idx++;
          }
          const { name, unitSuffix } = bandCosmetics(bar.segment);
          cells.push(
            <button
              type="button"
              key={bar.segment.id}
              onClick={() => onSelect(bar.segment)}
              className="flex min-h-12 items-center border-b border-r border-border/60 p-1 transition-transform active:scale-[0.99]"
              style={{ ...rowBg, gridColumn: `span ${span}` }}
            >
              <div
                className="flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
                style={bandPill}
              >
                <span className="truncate">{name}</span>
                {span > 1 && (
                  <span className="ml-auto pl-1 text-[10px] font-normal opacity-80">
                    {span}{unitSuffix}
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
              key={`${keyPrefix}-${trackIdx}-${idx}`}
              className="min-h-12 border-b border-r border-border/60"
              style={rowBg}
            />,
          );
          idx++;
        }
        return (
          <React.Fragment key={`${keyPrefix}-track-${trackIdx}`}>
            {trackIdx === 0 && rowLabel ? (
              <RowLabel icon={rowLabel.icon} name={rowLabel.name} />
            ) : (
              <div
                className="sticky left-0 z-10 border-b border-r border-border/60 bg-card"
                aria-hidden
              />
            )}
            {cells}
          </React.Fragment>
        );
      })}
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
  const rentals = extractRentals(days);

  // Find the day containing the selected segment so the detail sheet
  // can show its date — same lookup the carousel does.
  const segmentDate = selectedSegment
    ? days.find((d) =>
        d.segments.some((s) => s.id === selectedSegment.id),
      )?.date
    : undefined;

  // Mobile-tuned column widths. Tuned so a 390px portrait phone fits
  // exactly 3 day columns and an 800px landscape phone fits ~5 columns.
  // In portrait the day track is a fixed 7rem so the grid stays snug and
  // pill content `truncate`s rather than ballooning a column. In
  // landscape the variable is overridden to `minmax(7rem, 1fr)` so the
  // grid stretches edge-to-edge of the rotated viewport — when there
  // are few days the columns expand instead of leaving the right half
  // of the screen empty. The wrapper's `overflow-auto` still scrolls
  // when the 7rem floor × N is wider than the viewport.
  //
  // The landscape label column is 7rem (vs 3rem portrait) so row names
  // like "ACTIVITIES" / "TRANSPORT" can render on a single line with
  // their icon, instead of breaking into a vertical letter-stack.
  //
  //   Portrait 390px: 3rem label + 3 × 7rem cols = 384px < 390 ✓
  //   Landscape 800px: 7rem label + 5 × 7rem cols = 672px < 800 ✓
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
    <div className="flex flex-1 flex-col overflow-hidden landscape:[--m-timeline-label-col:7rem] landscape:[--m-timeline-day-min:minmax(7rem,1fr)]">
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
              {/* Compound Transport lane: per-day pills + rental bands
                  in the SAME visual row. */}
              <TransportLane
                days={days}
                gridCols={gridCols}
                rentals={rentals}
                onSelect={setSelectedSegment}
              />
              <BandRows
                days={days}
                bars={hotels}
                category="hotel"
                keyPrefix="lodging"
                rowLabel={{
                  icon: SEGMENT_CONFIG.hotel.icon,
                  name: "Lodging",
                }}
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
              <BandRows
                days={days}
                bars={rentals}
                category="transport"
                keyPrefix="rental"
                rowLabel={{
                  icon: SEGMENT_CONFIG.car_rental.icon,
                  name: "Rentals",
                }}
                onSelect={setSelectedSegment}
              />
              <BandRows
                days={days}
                bars={hotels}
                category="hotel"
                keyPrefix="lodging"
                rowLabel={{
                  icon: SEGMENT_CONFIG.hotel.icon,
                  name: "Lodging",
                }}
                onSelect={setSelectedSegment}
              />
              <RowLabel icon={SEGMENT_CONFIG.activity.icon} name="All" />
              {days.map((day) => {
                // Exclude lodging-lane types — they render as bands
                // above and would otherwise double-up in the chrono row.
                const segs = sortByTime(
                  day.segments.filter(
                    (s) =>
                      s.type !== "hotel" &&
                      s.type !== "cruise" &&
                      s.type !== "car_rental",
                  ),
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
