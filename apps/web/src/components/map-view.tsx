"use client";

import { useState, useEffect, useCallback } from "react";
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
import { ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Category helpers ──────────────────────────────────────────

// Flights are excluded — airports aren't useful map destinations
const EXCLUDED_TYPES = new Set<SegmentType>(["flight"]);

type Category = "hotel" | "dining" | "activity" | "transport";

function getCategory(type: SegmentType): Category | null {
  if (EXCLUDED_TYPES.has(type)) return null;
  if (type === "hotel") return "hotel";
  if (
    type === "restaurant_breakfast" ||
    type === "restaurant_brunch" ||
    type === "restaurant_lunch" ||
    type === "restaurant_dinner"
  )
    return "dining";
  if (type === "activity" || type === "tour" || type === "cruise")
    return "activity";
  if (
    type === "train" ||
    type === "car_rental" ||
    type === "car_service" ||
    type === "other_transport"
  )
    return "transport";
  return null;
}

const PIN_COLOR: Record<Category, string> = {
  hotel:     "#2563eb", // blue
  dining:    "#dc2626", // red
  activity:  "#16a34a", // green
  transport: "#7c3aed", // purple
};

const CATEGORY_LABEL: Record<Category, string> = {
  hotel:     "Hotel",
  dining:    "Dining",
  activity:  "Activity",
  transport: "Transport",
};

// ── Data types ────────────────────────────────────────────────

interface RawPin {
  id: string;
  title: string;
  geocodeQuery: string;
  category: Category;
  segment: Segment;
  day: TripDay;
}

interface ResolvedPin extends RawPin {
  position: google.maps.LatLngLiteral;
}

// ── Helpers ───────────────────────────────────────────────────

function buildGeocodeQuery(segment: Segment, day: TripDay): string {
  if (segment.address) return segment.address;
  if (segment.venueName && day.city) return `${segment.venueName}, ${day.city}`;
  if (segment.venueName) return segment.venueName;
  if (segment.city) return segment.city;
  if (segment.departureCity) return segment.departureCity;
  return day.city;
}

function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildRawPins(trip: Trip): RawPin[] {
  return trip.days.flatMap((day) =>
    day.segments.flatMap((segment) => {
      const category = getCategory(segment.type);
      if (!category) return [];
      return [
        {
          id: segment.id,
          title: segment.venueName ?? segment.title,
          geocodeQuery: buildGeocodeQuery(segment, day),
          category,
          segment,
          day,
        },
      ];
    }),
  );
}

// ── KML export ────────────────────────────────────────────────

function buildKml(tripTitle: string, pins: ResolvedPin[]): string {
  const styleColors: Record<Category, string> = {
    hotel:     "ffeb4034", // blue (KML AABBGGRR)
    dining:    "ff2626dc", // red
    activity:  "ff4aa34a", // green
    transport: "ffed3a7c", // purple
  };

  const styles = (Object.keys(styleColors) as Category[])
    .map(
      (cat) =>
        `<Style id="${cat}"><IconStyle><color>${styleColors[cat]}</color><scale>1.1</scale></IconStyle></Style>`,
    )
    .join("\n    ");

  const placemarks = pins
    .map(
      (p) =>
        `<Placemark>
      <name>${escapeXml(p.title)}</name>
      <description>${escapeXml(p.day.date)} · ${CATEGORY_LABEL[p.category]}${p.segment.startTime ? ` · ${p.segment.startTime}` : ""}</description>
      <styleUrl>#${p.category}</styleUrl>
      <Point><coordinates>${p.position.lng},${p.position.lat},0</coordinates></Point>
    </Placemark>`,
    )
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(tripTitle)}</name>
    ${styles}
    ${placemarks}
  </Document>
</kml>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadKml(filename: string, kml: string) {
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Inner map — must be inside <APIProvider> ──────────────────

function MapInner({
  rawPins,
  tripTitle,
}: {
  rawPins: RawPin[];
  tripTitle: string;
}) {
  const map = useMap();
  const geocodingLib = useMapsLibrary("geocoding");

  const [resolvedPins, setResolvedPins] = useState<ResolvedPin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Geocode all pins once the library is ready
  useEffect(() => {
    if (!geocodingLib || rawPins.length === 0 || geocoding) return;
    setGeocoding(true);

    const geocoder = new geocodingLib.Geocoder();

    const geocodeOne = (pin: RawPin): Promise<ResolvedPin | null> =>
      new Promise((resolve) => {
        geocoder.geocode({ address: pin.geocodeQuery }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const { lat, lng } = results[0].geometry.location;
            resolve({ ...pin, position: { lat: lat(), lng: lng() } });
          } else {
            resolve(null);
          }
        });
      });

    Promise.all(rawPins.map(geocodeOne)).then((results) => {
      setResolvedPins(results.filter((r): r is ResolvedPin => r !== null));
    });
  }, [geocodingLib, rawPins, geocoding]);

  // Fit map bounds once pins are resolved
  useEffect(() => {
    if (!map || resolvedPins.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    resolvedPins.forEach((p) => bounds.extend(p.position));
    map.fitBounds(bounds, 60);
  }, [map, resolvedPins]);

  const handleExportKml = useCallback(() => {
    const kml = buildKml(tripTitle, resolvedPins);
    const slug = tripTitle.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    downloadKml(`${slug}-map.kml`, kml);
  }, [tripTitle, resolvedPins]);

  const selectedPin = resolvedPins.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-3">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => (
            <div key={cat} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: PIN_COLOR[cat] }}
              />
              {CATEGORY_LABEL[cat]}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportKml}
          disabled={resolvedPins.length === 0}
          title="Download KML to import into Google My Maps"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export to My Maps
        </Button>
      </div>

      {/* Map */}
      <div className="rounded-xl border border-gray-200 overflow-hidden" style={{ height: 560 }}>
        <Map
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
          defaultCenter={{ lat: 35.6762, lng: 139.6503 }}
          defaultZoom={5}
          style={{ width: "100%", height: "100%" }}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          {resolvedPins.map((pin) => (
            <AdvancedMarker
              key={pin.id}
              position={pin.position}
              onClick={() => setSelectedId(pin.id === selectedId ? null : pin.id)}
            >
              <Pin
                background={PIN_COLOR[pin.category]}
                glyphColor="#fff"
                borderColor={PIN_COLOR[pin.category]}
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
                <p className="font-semibold text-gray-900 mb-0.5">{selectedPin.title}</p>
                <p className="text-xs text-gray-500 mb-1">
                  {CATEGORY_LABEL[selectedPin.category]} ·{" "}
                  {new Date(selectedPin.day.date + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  {selectedPin.segment.startTime && ` · ${selectedPin.segment.startTime}`}
                </p>
                {selectedPin.segment.address && (
                  <p className="text-xs text-gray-500 mb-1.5">{selectedPin.segment.address}</p>
                )}
                {selectedPin.segment.confirmationCode && (
                  <p className="text-xs text-gray-400 mb-1.5 font-mono">
                    #{selectedPin.segment.confirmationCode}
                  </p>
                )}
                <a
                  href={mapsSearchUrl(selectedPin.geocodeQuery)}
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
      </div>

      {resolvedPins.length === 0 && geocoding && (
        <p className="text-xs text-gray-400 text-center">Locating places…</p>
      )}
      {resolvedPins.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {resolvedPins.length} location{resolvedPins.length !== 1 ? "s" : ""} plotted ·
          Click a pin for details · Use <strong>Export to My Maps</strong> to save as a Google Maps list
        </p>
      )}
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────

export function MapView({ trip }: { trip: Trip }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const rawPins = buildRawPins(trip);

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-8 py-16 text-center">
        <p className="text-sm font-medium text-gray-700 mb-1">Google Maps API key not configured</p>
        <p className="text-sm text-gray-500">
          Set{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
          in <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">apps/web/.env.local</code> to
          enable the map view.
        </p>
      </div>
    );
  }

  if (rawPins.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-8 py-16 text-center text-sm text-gray-400">
        No mappable locations yet. Add hotels, restaurants, or activities to see them here.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <MapInner rawPins={rawPins} tripTitle={trip.title} />
    </APIProvider>
  );
}
