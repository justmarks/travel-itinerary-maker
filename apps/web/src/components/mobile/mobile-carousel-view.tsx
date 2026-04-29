"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Trip, Segment } from "@travel-app/shared";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  LayoutList,
  MapPin,
} from "lucide-react";
import { MobileSegmentCard } from "./mobile-segment-card";
import { MobileDayMap } from "./mobile-day-map";
import { MobileDaysList } from "./mobile-feed-view";
import { MobileSegmentDetailSheet } from "./mobile-segment-detail-sheet";
import { MobileCostsSheet } from "./mobile-costs-sheet";
import { MobileTodosSheet } from "./mobile-todos-sheet";
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

/**
 * Carousel layout: an "All" overview page at index 0, followed by one page
 * per day. The map header up top swaps to match the active page — fitting
 * to all pins for "All", and to that day's pins for individual days.
 *
 * Tapping a segment opens a bottom-sheet detail view (state lives here so
 * only one sheet is ever open across pages).
 */
export function MobileCarouselView({ trip }: { trip: Trip }): React.JSX.Element {
  const days = trip.days;
  // Index 0 = "All" overview; indices 1..days.length = individual days.
  const totalPages = days.length + 1;

  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dayStripRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScroll = useRef(false);

  const todoSummary = useMemo(() => {
    const total = trip.todos.length;
    const remaining = trip.todos.filter((t) => !t.isCompleted).length;
    return { total, remaining };
  }, [trip.todos]);

  // Quick USD total for the footer "Costs" pill. Recomputed from the trip's
  // segment costs since we don't fetch the full cost summary at this level.
  // Foreign currencies without USD conversion are excluded — the sheet shows
  // them as separate totals.
  const usdTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.cost?.currency === "USD" && typeof seg.cost.amount === "number") {
          sum += seg.cost.amount;
          any = true;
        }
      }
    }
    return any ? sum : null;
  }, [trip.days]);

  function fmtUsdCompact(n: number): string {
    if (n >= 10000) {
      return `$${(n / 1000).toFixed(1)}k`;
    }
    return `$${Math.round(n).toLocaleString()}`;
  }

  const isAllView = activeIdx === 0;
  const activeDay = isAllView ? null : days[activeIdx - 1] ?? null;

  // Find which day a segment belongs to so the detail sheet can show its
  // date — the carousel's per-day pages don't pass it through directly.
  const segmentDate = useMemo(() => {
    if (!selectedSegment) return undefined;
    return days.find((d) =>
      d.segments.some((s) => s.id === selectedSegment.id),
    )?.date;
  }, [days, selectedSegment]);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIdx((current) => (current === idx ? current : idx));
  }, []);

  useEffect(() => {
    const strip = dayStripRef.current;
    if (!strip) return;
    const chip = strip.querySelector<HTMLElement>(`[data-page-idx="${activeIdx}"]`);
    if (chip) {
      chip.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeIdx]);

  const goToPage = useCallback((idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    isProgrammaticScroll.current = true;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    setActiveIdx(idx);
    window.setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 400);
  }, []);

  const tripStats = useMemo(() => {
    const cities = new Set<string>();
    let segmentCount = 0;
    for (const d of days) {
      if (d.city) cities.add(d.city);
      segmentCount += d.segments.length;
    }
    return { cities: Array.from(cities), segmentCount };
  }, [days]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Compact trip header */}
      <div className="shrink-0 border-b bg-background px-4 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="truncate text-lg font-bold">{trip.title}</h1>
          <span className="shrink-0 text-xs text-muted-foreground">
            {isAllView ? "Overview" : `Day ${activeIdx}/${days.length}`}
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
          <button
            data-page-idx={0}
            onClick={() => goToPage(0)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isAllView
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutList className="h-3 w-3" />
            All
          </button>
          {days.map((d, i) => {
            const pageIdx = i + 1;
            const active = pageIdx === activeIdx;
            return (
              <button
                key={d.date}
                data-page-idx={pageIdx}
                onClick={() => goToPage(pageIdx)}
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
        <MobileDayMap trip={trip} activeDate={activeDay?.date} height={210} />
        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {isAllView
              ? `${tripStats.segmentCount} segment${tripStats.segmentCount === 1 ? "" : "s"} · ${days.length} days`
              : (activeDay?.city ?? "—")}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => activeIdx > 0 && goToPage(activeIdx - 1)}
              disabled={activeIdx === 0}
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-background disabled:opacity-30"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => activeIdx < totalPages - 1 && goToPage(activeIdx + 1)}
              disabled={activeIdx === totalPages - 1}
              className="flex h-7 w-7 items-center justify-center rounded-full border bg-background disabled:opacity-30"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal swipe carousel */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden no-scrollbar overscroll-x-contain"
      >
        {/* All-overview page */}
        <div className="flex h-full w-full shrink-0 snap-start snap-always flex-col overflow-y-auto">
          <MobileDaysList days={days} onSelectSegment={setSelectedSegment} />
        </div>

        {/* Per-day pages */}
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
                    <MobileSegmentCard
                      key={seg.id}
                      segment={seg}
                      onSelect={setSelectedSegment}
                    />
                  ))
                )}
                <div className="h-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: prominent dual pill buttons with value-at-a-glance, plus
          the page-dot indicator above. Bigger touch targets and filled
          backgrounds make the buttons obvious without needing to scan. */}
      <div className="shrink-0 border-t bg-background pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => goToPage(i)}
              aria-label={i === 0 ? "Overview" : `Go to day ${i}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeIdx
                  ? "w-4 bg-foreground"
                  : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 px-3">
          <button
            type="button"
            onClick={() => setCostsOpen(true)}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-muted text-sm font-semibold text-foreground transition-colors active:bg-muted/70"
            aria-label="Open costs"
          >
            <DollarSign className="h-4 w-4" />
            <span>{usdTotal !== null ? fmtUsdCompact(usdTotal) : "Costs"}</span>
          </button>

          <button
            type="button"
            onClick={() => setTodosOpen(true)}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-muted text-sm font-semibold text-foreground transition-colors active:bg-muted/70"
            aria-label={`Open to-dos${todoSummary.total ? ` (${todoSummary.remaining} remaining)` : ""}`}
          >
            <CheckSquare className="h-4 w-4" />
            <span>
              {todoSummary.total === 0
                ? "To-do"
                : todoSummary.remaining === 0
                  ? "All done"
                  : `${todoSummary.remaining} left`}
            </span>
          </button>
        </div>
      </div>

      {/* Sheets — they overlay the whole MobileFrame */}
      <MobileSegmentDetailSheet
        segment={selectedSegment}
        date={segmentDate}
        onClose={() => setSelectedSegment(null)}
      />
      <MobileCostsSheet
        tripId={trip.id}
        open={costsOpen}
        onClose={() => setCostsOpen(false)}
      />
      <MobileTodosSheet
        tripId={trip.id}
        todos={trip.todos}
        open={todosOpen}
        onClose={() => setTodosOpen(false)}
      />
    </div>
  );
}
