"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { Trip, TripDay, Segment, SegmentType } from "@travel-app/shared";
import { ExternalLink, MapPin, X } from "lucide-react";
import {
  useCategoryPinColors,
  type PinCategory,
} from "@/lib/category-pin-colors";
import { cn } from "@/lib/utils";

const EXCLUDED: Set<SegmentType> = new Set(["flight"]);

function getCategory(type: SegmentType): PinCategory | null {
  if (EXCLUDED.has(type)) return null;
  if (type === "hotel") return "hotel";
  if (type.startsWith("restaurant_")) return "dining";
  if (
    type === "activity" ||
    type === "tour" ||
    type === "cruise" ||
    type === "show"
  ) {
    return "activity";
  }
  return "transport";
}

const CATEGORY_LABEL: Record<PinCategory, string> = {
  hotel: "Lodging",
  dining: "Dining",
  activity: "Activity",
  transport: "Transport",
};

interface RawPin {
  id: string;
  title: string;
  query: string;
  category: PinCategory;
  segment: Segment;
  day: TripDay;
}

interface ResolvedPin extends RawPin {
  position: google.maps.LatLngLiteral;
}

function buildQuery(s: Segment, day: TripDay): string {
  if (s.address) return s.address;
  if (s.venueName && day.city) return `${s.venueName}, ${day.city}`;
  if (s.venueName) return s.venueName;
  if (s.city) return s.city;
  if (s.departureCity) return s.departureCity;
  return day.city;
}

function rawPinsForTrip(trip: Trip): RawPin[] {
  return trip.days.flatMap((day) =>
    day.segments.flatMap((s) => {
      const cat = getCategory(s.type);
      if (!cat) return [];
      return [
        {
          id: s.id,
          title: s.venueName ?? s.title,
          query: buildQuery(s, day),
          category: cat,
          segment: s,
          day,
        },
      ];
    }),
  );
}

function dayShort(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function dayWeekday(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Full-screen map overlay for `/m`. Shows every pinnable segment on
 * the trip with a horizontal day-filter strip at the top so the user
 * can scope to a single day or view all. Tapping a pin opens an
 * `InfoWindow` with venue / date / "Open in Google Maps" — a thumb-
 * sized version of the desktop `MapView`.
 *
 * Mounted at z-50 like the bottom sheets but takes the full viewport
 * (maps need real estate). Body scroll is locked while open and Esc
 * closes — same conventions as `MobileBottomSheet`.
 */
export function MobileFullMapSheet({
  trip,
  open,
  onClose,
  initialDate,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
  /**
   * Day to focus on at first open. When omitted (e.g. expanded from
   * the carousel's "All" page), the map fits all pins.
   */
  initialDate?: string;
}): React.JSX.Element | null {
  // Lock body scroll + dismiss on Escape so desktop testing isn't a trap.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Trip map"
    >
      <FullMapBody trip={trip} initialDate={initialDate} onClose={onClose} />
    </div>
  );
}

function FullMapBody({
  trip,
  onClose,
  initialDate,
}: {
  trip: Trip;
  onClose: () => void;
  initialDate?: string;
}): React.JSX.Element {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const rawPins = useMemo(() => rawPinsForTrip(trip), [trip]);
  const [filterDate, setFilterDate] = useState<string | null>(
    initialDate ?? null,
  );

  if (!apiKey) {
    return (
      <>
        <Header trip={trip} onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <MapPin className="h-8 w-8" />
          <p className="text-sm font-medium text-foreground">
            Map preview unavailable
          </p>
          <p className="max-w-[280px] text-xs">
            Google Maps API key isn&apos;t configured. Add{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
            </code>{" "}
            to <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.env.local</code> to enable.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header trip={trip} onClose={onClose} />
      <DayFilterStrip
        days={trip.days}
        filterDate={filterDate}
        onChange={setFilterDate}
      />
      <div className="flex-1">
        <APIProvider apiKey={apiKey}>
          <FullMapInner rawPins={rawPins} filterDate={filterDate} />
        </APIProvider>
      </div>
    </>
  );
}

function Header({
  trip,
  onClose,
}: {
  trip: Trip;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close map"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-kicker font-semibold text-muted-foreground">Map</p>
        <h2 className="truncate text-sm font-semibold leading-tight">
          {trip.title}
        </h2>
      </div>
    </div>
  );
}

function DayFilterStrip({
  days,
  filterDate,
  onChange,
}: {
  days: readonly TripDay[];
  filterDate: string | null;
  onChange: (next: string | null) => void;
}): React.JSX.Element {
  return (
    <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-border/60 bg-background px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          filterDate === null
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {days.map((d) => {
        const active = filterDate === d.date;
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => onChange(d.date)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="mr-1 opacity-70">{dayWeekday(d.date)}</span>
            <span>{dayShort(d.date)}</span>
          </button>
        );
      })}
    </div>
  );
}

function FullMapInner({
  rawPins,
  filterDate,
}: {
  rawPins: RawPin[];
  filterDate: string | null;
}): React.JSX.Element {
  const map = useMap();
  const geocodingLib = useMapsLibrary("geocoding");
  const [resolved, setResolved] = useState<ResolvedPin[]>([]);
  const [done, setDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pinColors = useCategoryPinColors();

  // Geocode all pins once on mount and cache. Filtering by day after
  // that is a pure derivation, so swiping between day filters is free.
  useEffect(() => {
    if (!geocodingLib || rawPins.length === 0 || done) return;
    const geocoder = new geocodingLib.Geocoder();
    const geocodeOne = (pin: RawPin): Promise<ResolvedPin | null> =>
      new Promise((resolve) => {
        geocoder.geocode({ address: pin.query }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const { lat, lng } = results[0].geometry.location;
            resolve({ ...pin, position: { lat: lat(), lng: lng() } });
          } else {
            resolve(null);
          }
        });
      });
    Promise.all(rawPins.map(geocodeOne)).then((results) => {
      setResolved(results.filter((r): r is ResolvedPin => r !== null));
      setDone(true);
    });
  }, [geocodingLib, rawPins, done]);

  const visiblePins = useMemo(
    () =>
      filterDate ? resolved.filter((p) => p.day.date === filterDate) : resolved,
    [resolved, filterDate],
  );

  // Re-fit bounds whenever the visible set changes (initial load,
  // day-filter change). Single-pin sets pan + zoom to a friendly level
  // instead of fitBounds which would zoom in maximally.
  useEffect(() => {
    if (!map || visiblePins.length === 0) return;
    if (visiblePins.length === 1) {
      map.panTo(visiblePins[0].position);
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    visiblePins.forEach((p) => bounds.extend(p.position));
    map.fitBounds(bounds, 60);
  }, [map, visiblePins]);

  const selectedPin = visiblePins.find((p) => p.id === selectedId) ?? null;

  return (
    <Map
      mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
      defaultCenter={{ lat: 35.6762, lng: 139.6503 }}
      defaultZoom={5}
      style={{ width: "100%", height: "100%" }}
      gestureHandling="greedy"
      // Zoom controls + map-type toggle are useful at full-screen, even
      // on touch — keep them rather than disabling all default UI.
      disableDefaultUI={false}
      zoomControl
      // Hide the street-view pegman, fullscreen, and map-type toggles —
      // they crowd a small viewport and aren't useful on mobile.
      streetViewControl={false}
      fullscreenControl={false}
      mapTypeControl={false}
    >
      {visiblePins.map((pin) => (
        <AdvancedMarker
          key={pin.id}
          position={pin.position}
          onClick={() =>
            setSelectedId(pin.id === selectedId ? null : pin.id)
          }
        >
          <Pin
            background={pinColors[pin.category]}
            glyphColor="#fff"
            borderColor={pinColors[pin.category]}
          />
        </AdvancedMarker>
      ))}

      {selectedPin && (
        <InfoWindow
          position={selectedPin.position}
          onCloseClick={() => setSelectedId(null)}
          pixelOffset={[0, -40]}
        >
          <div className="text-sm" style={{ maxWidth: 240 }}>
            <p className="mb-0.5 font-semibold text-gray-900">
              {selectedPin.title}
            </p>
            <p className="mb-1 text-xs text-gray-500">
              {CATEGORY_LABEL[selectedPin.category]} ·{" "}
              {dayShort(selectedPin.day.date)}
              {selectedPin.segment.startTime &&
                ` · ${selectedPin.segment.startTime}`}
            </p>
            {selectedPin.segment.address && (
              <p className="mb-1.5 text-xs text-gray-500">
                {selectedPin.segment.address}
              </p>
            )}
            <a
              href={mapsSearchUrl(selectedPin.query)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              Open in Google Maps
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </InfoWindow>
      )}
    </Map>
  );
}
