"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Trip, Segment } from "@travel-app/shared";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { MobileSegmentCard } from "./mobile-segment-card";
import { MobileDayMap } from "./mobile-day-map";
import { cn } from "@/lib/utils";

function sortSegments(segments: readonly Segment[]): Segment[] {
  return [...segments].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

function dayShort(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function MobileCarouselView({ trip }: { trip: Trip }): React.JSX.Element {
  const days = trip.days;
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dayStripRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScroll = useRef(false);

  const activeDay = days[activeIdx] ?? days[0];

  // Detect which day card is centred in the horizontal scroller.
  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIdx((current) => (current === idx ? current : idx));
  }, []);

  // When the active day changes (via tap on day strip), keep the day strip
  // chip scrolled into view so the user can always see what's selected.
  useEffect(() => {
    const strip = dayStripRef.current;
    if (!strip) return;
    const chip = strip.querySelector<HTMLElement>(`[data-day-idx="${activeIdx}"]`);
    if (chip) {
      chip.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeIdx]);

  const goToDay = useCallback((idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    isProgrammaticScroll.current = true;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    setActiveIdx(idx);
    // Release the lock after the smooth-scroll likely completes.
    window.setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 400);
  }, []);

  const tripStats = useMemo(() => {
    const cities = new Set<string>();
    for (const d of days) if (d.city) cities.add(d.city);
    return { cities: Array.from(cities) };
  }, [days]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Compact trip header */}
      <div className="shrink-0 border-b bg-background px-4 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="truncate text-lg font-bold">{trip.title}</h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            Day {activeIdx + 1}/{days.length}
          </span>
        </div>
        {tripStats.cities.length > 0 && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {tripStats.cities.join(" · ")}
          </p>
        )}
      </div>

      {/* Day strip */}
      <div className="shrink-0 border-b bg-background">
        <div
          ref={dayStripRef}
          className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2"
        >
          {days.map((d, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={d.date}
                data-day-idx={i}
                onClick={() => goToDay(i)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="mr-1 opacity-70">{d.dayOfWeek}</span>
                <span>{dayShort(d.date)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Map header (shared, swaps as user swipes) */}
      <div className="shrink-0 border-b bg-zinc-100">
        {activeDay && (
          <MobileDayMap trip={trip} activeDate={activeDay.date} height={210} />
        )}
        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {activeDay?.city ?? "—"}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => activeIdx > 0 && goToDay(activeIdx - 1)}
              disabled={activeIdx === 0}
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-background disabled:opacity-30"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => activeIdx < days.length - 1 && goToDay(activeIdx + 1)}
              disabled={activeIdx === days.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-background disabled:opacity-30"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal swipe carousel of day pages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden no-scrollbar overscroll-x-contain"
      >
        {days.map((day) => {
          const sorted = sortSegments(day.segments);
          return (
            <div
              key={day.date}
              className="flex h-full w-full shrink-0 snap-start snap-always flex-col overflow-y-auto"
            >
              <div className="flex flex-col gap-2.5 px-4 py-4">
                <div className="flex items-baseline gap-2 pb-1">
                  <h2 className="text-base font-semibold">
                    {day.dayOfWeek}, {dayShort(day.date)}
                  </h2>
                  {sorted.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {sorted.length} {sorted.length === 1 ? "item" : "items"}
                    </span>
                  )}
                </div>
                {sorted.length === 0 ? (
                  <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    Nothing planned this day.
                  </p>
                ) : (
                  sorted.map((seg) => (
                    <MobileSegmentCard key={seg.id} segment={seg} />
                  ))
                )}
                <div className="h-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pager dots */}
      <div className="shrink-0 border-t bg-background py-2">
        <div className="flex items-center justify-center gap-1.5">
          {days.map((d, i) => (
            <button
              key={d.date}
              onClick={() => goToDay(i)}
              aria-label={`Go to day ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeIdx
                  ? "w-4 bg-foreground"
                  : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
