"use client";

import type { TripDay, Segment } from "@travel-app/shared";
import { MapPin, ArrowDown, Plane, Train } from "lucide-react";
import { MobileSegmentCard } from "./mobile-segment-card";

function fmtDayHeader(date: string, dayOfWeek: string) {
  const d = new Date(date + "T00:00:00");
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { weekday: dayOfWeek, md };
}

function sortSegments(segments: readonly Segment[]): Segment[] {
  return [...segments].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Picks the inter-day connection (flight, train, or generic transport) when a
 * segment of that type starts the next day — used to render a small chip
 * between days so the reader can see "how do we get from Tokyo to Kyoto?".
 */
function findIntercityConnection(nextDay: TripDay): Segment | null {
  for (const seg of nextDay.segments) {
    if (seg.type === "flight" || seg.type === "train") return seg;
  }
  return null;
}

/**
 * Renders the trip as a single vertical scroll with sticky day headers and
 * inter-day transition chips. Used as the "All" page inside the carousel.
 *
 * `stickyHeaderTopClass` lets the caller tune where day headers stick. When
 * embedded under additional sticky chrome (the carousel's day strip + map),
 * a zero offset is correct because the parent already creates a fresh
 * scrolling context.
 *
 * `onSelectSegment` (optional) makes each card tappable; passing it lets the
 * parent open a detail sheet.
 */
export function MobileDaysList({
  days,
  stickyHeaderTopClass = "top-0",
  onSelectSegment,
  showCosts = true,
}: {
  days: readonly TripDay[];
  stickyHeaderTopClass?: string;
  onSelectSegment?: (segment: Segment) => void;
  /**
   * Threaded down to `MobileSegmentCard`. When false, suppresses the
   * inline cost line — used by the contributor view of a shared trip
   * with `showCosts: false`. Defaults true so the public viewer (which
   * also uses this list) and owned-trip rendering stay unchanged.
   */
  showCosts?: boolean;
}): React.JSX.Element {
  return (
    <div className="pb-10">
      {days.map((day, i) => {
        const { weekday, md } = fmtDayHeader(day.date, day.dayOfWeek);
        const sorted = sortSegments(day.segments);
        const prevDay = i > 0 ? days[i - 1] : null;
        const cityChanged =
          prevDay && prevDay.city && day.city && prevDay.city !== day.city;
        const connector = cityChanged ? findIntercityConnection(day) : null;

        return (
          <section key={day.date}>
            {cityChanged && (
              <div className="flex items-center justify-center px-5 py-3">
                <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs text-muted-foreground">
                  <ArrowDown className="h-3 w-3" />
                  {prevDay?.city} → {day.city}
                  {connector && connector.type === "flight" && (
                    <>
                      <span aria-hidden>·</span>
                      <Plane className="h-3 w-3" />
                      <span>{connector.title.replace(/\s*\(.*\)\s*$/, "")}</span>
                    </>
                  )}
                  {connector && connector.type === "train" && (
                    <>
                      <span aria-hidden>·</span>
                      <Train className="h-3 w-3" />
                    </>
                  )}
                </div>
              </div>
            )}

            <div
              className={`sticky ${stickyHeaderTopClass} z-20 -mb-px border-b border-border/60 bg-background/90 px-5 py-2.5 backdrop-blur`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Day {i + 1}
                  </span>
                  <h2 className="text-base font-semibold">
                    {weekday}, {md}
                  </h2>
                </div>
                {day.city && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {day.city}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 px-4 py-4">
              {sorted.length === 0 ? (
                <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing planned.
                </p>
              ) : (
                sorted.map((seg) => (
                  <MobileSegmentCard
                    key={seg.id}
                    segment={seg}
                    onSelect={onSelectSegment}
                    showCosts={showCosts}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
