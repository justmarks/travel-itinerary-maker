"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { Trip, TripDay, Segment, SegmentType } from "@travel-app/shared";
import { MapPin } from "lucide-react";

const EXCLUDED: Set<SegmentType> = new Set(["flight"]);

type Category = "hotel" | "dining" | "activity" | "transport";

const PIN_COLOR: Record<Category, string> = {
  hotel:     "#2563eb",
  dining:    "#dc2626",
  activity:  "#16a34a",
  transport: "#7c3aed",
};

function getCategory(type: SegmentType): Category | null {
  if (EXCLUDED.has(type)) return null;
  if (type === "hotel") return "hotel";
  if (type.startsWith("restaurant_")) return "dining";
  if (type === "activity" || type === "tour" || type === "cruise" || type === "show") return "activity";
  return "transport";
}

interface RawPin {
  id: string;
  query: string;
  category: Category;
  segment: Segment;
  date: string;
}

interface ResolvedPin extends RawPin {
  position: google.maps.LatLngLiteral;
}

function buildQuery(s: Segment, day: TripDay): string {
  if (s.address) return s.address;
  if (s.venueName && day.city) return `${s.venueName}, ${day.city}`;
  if (s.venueName) return s.venueName;
  if (s.city) return s.city;
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
          query: buildQuery(s, day),
          category: cat,
          segment: s,
          date: day.date,
        },
      ];
    }),
  );
}

/**
 * Renders a slim map widget keyed by `activeDate` — the parent decides which
 * day is visible, and the inner map fits its bounds to that day's resolved
 * pins. All pins for the trip are geocoded once on mount and cached, so
 * swiping between days is cheap.
 */
function DayMapInner({
  rawPins,
  activeDate,
}: {
  rawPins: RawPin[];
  activeDate: string;
}) {
  const map = useMap();
  const geocodingLib = useMapsLibrary("geocoding");
  const [resolved, setResolved] = useState<ResolvedPin[]>([]);
  const [done, setDone] = useState(false);

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

  const dayPins = useMemo(
    () => resolved.filter((p) => p.date === activeDate),
    [resolved, activeDate],
  );

  // Fit the map to the active day's pins as the parent swipes between days.
  useEffect(() => {
    if (!map || dayPins.length === 0) return;
    if (dayPins.length === 1) {
      map.panTo(dayPins[0].position);
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    dayPins.forEach((p) => bounds.extend(p.position));
    map.fitBounds(bounds, 60);
  }, [map, dayPins]);

  return (
    <Map
      mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
      defaultCenter={{ lat: 35.6762, lng: 139.6503 }}
      defaultZoom={5}
      style={{ width: "100%", height: "100%" }}
      gestureHandling="greedy"
      disableDefaultUI={true}
    >
      {dayPins.map((pin, i) => (
        <AdvancedMarker key={pin.id} position={pin.position}>
          <Pin
            background={PIN_COLOR[pin.category]}
            glyphColor="#fff"
            borderColor={PIN_COLOR[pin.category]}
            glyph={`${i + 1}`}
            scale={0.9}
          />
        </AdvancedMarker>
      ))}
    </Map>
  );
}

export function MobileDayMap({
  trip,
  activeDate,
  height = 200,
}: {
  trip: Trip;
  activeDate: string;
  height?: number;
}): React.JSX.Element {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const rawPins = useMemo(() => rawPinsForTrip(trip), [trip]);
  const dayCount = useMemo(
    () => rawPins.filter((p) => p.date === activeDate).length,
    [rawPins, activeDate],
  );

  if (!apiKey) {
    // Graceful fallback: a stylised placeholder so the UX still reads
    // correctly when the demo deployment doesn't have the maps key.
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center gap-1 bg-[radial-gradient(circle_at_30%_20%,#dbeafe_0%,transparent_40%),radial-gradient(circle_at_70%_70%,#fce7f3_0%,transparent_40%),linear-gradient(135deg,#f1f5f9,#e2e8f0)] text-muted-foreground"
      >
        <MapPin className="h-5 w-5" />
        <p className="text-xs font-medium">Map preview</p>
        <p className="text-[10px]">{dayCount} location{dayCount === 1 ? "" : "s"}</p>
      </div>
    );
  }

  return (
    <div style={{ height }} className="relative">
      <APIProvider apiKey={apiKey}>
        <DayMapInner rawPins={rawPins} activeDate={activeDate} />
      </APIProvider>
    </div>
  );
}
