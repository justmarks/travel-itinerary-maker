/**
 * Helpers for the visual hero on TripCard:
 * - `useCityImage` — fetches a city thumbnail from Wikipedia (no API key)
 * - `flagEmoji`   — country code → flag emoji
 * - `daysUntil`   — days between today and a YYYY-MM-DD date
 * - `gradientFor` — deterministic gradient for fallbacks (no image)
 *
 * The Wikipedia REST API is used because it's free, requires no key, and
 * covers most cities a real itinerary would reference. When it 404s (small
 * towns, ports), we fall back to the country page; when *that* also 404s
 * the card renders a deterministic gradient with the city name and flag.
 */

import { useQuery } from "@tanstack/react-query";

export interface CityImage {
  url: string;
  /** Wikipedia page URL — used for image attribution. */
  pageUrl?: string;
}

interface WikipediaSummary {
  type?: string;
  title?: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
  content_urls?: {
    desktop?: { page?: string };
  };
}

async function fetchSummary(query: string): Promise<WikipediaSummary | undefined> {
  // Wikipedia normalises spaces to underscores; encodeURIComponent handles
  // diacritics (Reykjavík) and apostrophes correctly.
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    query.replace(/\s+/g, "_"),
  )}`;
  let res: Response;
  try {
    res = await fetch(url, {
      // Wikimedia REST policy requires identifying the caller. Without a
      // distinct Api-User-Agent header, requests from a popular CDN
      // origin can get rate-limited or blocked silently. Using the
      // browser's `User-Agent` isn't enough — they want an app-level
      // identifier.
      headers: {
        Accept: "application/json",
        "Api-User-Agent": "itinly (itinly.app)",
      },
    });
  } catch (err) {
    // Network error — log so it shows up in DevTools and the caller can
    // fall back to the gradient placeholder.
    console.warn(
      `[trip-card-visuals] Wikipedia fetch failed for "${query}":`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
  if (!res.ok) return undefined;
  const data = (await res.json()) as WikipediaSummary;
  // Wikipedia returns 200 with `type === "disambiguation"` for ambiguous
  // queries — those don't have a useful representative image.
  if (data.type === "disambiguation") return undefined;
  return data;
}

interface WikipediaSearchHit {
  title: string;
}

interface WikipediaSearchResponse {
  query?: {
    search?: WikipediaSearchHit[];
  };
}

/**
 * Falls back to MediaWiki's search API when the direct summary endpoint
 * 404s. The summary endpoint requires an exact canonical title, so cities
 * with disambiguators ("Palm Desert" → "Palm Desert, California") miss it
 * entirely. Search returns the top relevance hit, which we then feed back
 * into `fetchSummary` to get the article's image.
 */
async function searchForArticleTitle(
  query: string,
  hint?: string,
): Promise<string | undefined> {
  const fullQuery = hint ? `${query} ${hint}` : query;
  const url =
    `https://en.wikipedia.org/w/api.php` +
    `?action=query&format=json&list=search&srlimit=1` +
    `&srsearch=${encodeURIComponent(fullQuery)}` +
    // origin=* permits the CORS request from arbitrary origins.
    `&origin=*`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Api-User-Agent": "itinly (itinly.app)",
      },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as WikipediaSearchResponse;
    return data.query?.search?.[0]?.title;
  } catch (err) {
    console.warn(
      `[trip-card-visuals] Wikipedia search failed for "${fullQuery}":`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

function pickImageFromSummary(summary: WikipediaSummary | undefined): CityImage | undefined {
  if (!summary) return undefined;
  // Prefer the thumbnail (~320px) — the hero band is only ~128px tall, so the
  // full-resolution `originalimage` (often >5MP) wastes bandwidth.
  const source = summary.thumbnail?.source ?? summary.originalimage?.source;
  if (!source) return undefined;
  return { url: source, pageUrl: summary.content_urls?.desktop?.page };
}

/**
 * React Query hook that resolves a hero image URL for a city. Tries, in
 * order: a direct summary by raw city name, a MediaWiki search-then-summary
 * (handles cities like "Palm Desert" whose canonical title is "Palm
 * Desert, California"), and finally the country article. Returns
 * `undefined` while loading and on total miss — callers should render a
 * gradient placeholder.
 *
 * Cached forever (`staleTime: Infinity`) per (city, country) tuple.
 */
export function useCityImage(
  city: string | undefined,
  country: string | undefined,
): CityImage | undefined {
  const enabled = Boolean(city);
  const { data } = useQuery({
    queryKey: ["city-image", city, country],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async (): Promise<CityImage | null> => {
      const cityHead = city!.split(",")[0]?.trim() ?? city!;

      // 1) Try the raw title — fast path for unambiguous cities.
      const direct = pickImageFromSummary(await fetchSummary(cityHead));
      if (direct) return direct;

      // 2) Search for the article. Use the country (if known) as a hint
      //    so "Palm Desert" lands on "Palm Desert, California" rather
      //    than disambiguating to a generic landform.
      const matchedTitle = await searchForArticleTitle(cityHead, country);
      if (matchedTitle) {
        const searched = pickImageFromSummary(await fetchSummary(matchedTitle));
        if (searched) return searched;
      }

      // 3) Country fallback so cruise stops and small towns still show
      //    *something* recognisable.
      if (country) {
        const countryResult = pickImageFromSummary(await fetchSummary(country));
        if (countryResult) return countryResult;
      }

      return null;
    },
  });
  return data ?? undefined;
}

/**
 * Convert an ISO 3166-1 alpha-2 country code to the matching flag emoji
 * (regional indicator pair). Returns `undefined` for invalid codes so the
 * caller can omit the element entirely rather than render a tofu glyph.
 */
export function flagEmoji(countryCode: string | undefined): string | undefined {
  if (!countryCode || countryCode.length !== 2) return undefined;
  const upper = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return undefined;
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + upper.charCodeAt(0) - 65,
    A + upper.charCodeAt(1) - 65,
  );
}

/**
 * Whole-day delta between today (local) and a YYYY-MM-DD date. Positive for
 * future dates, zero on the day, negative for the past. Computed in local
 * time so an itinerary that starts "tomorrow" reads "in 1 day" regardless
 * of the user's timezone.
 */
export function daysUntil(isoDate: string): number {
  const target = new Date(isoDate + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

/**
 * Pick a deterministic two-stop gradient based on a string seed (the city
 * name). Used as a fallback hero when no image is available — looks
 * intentional and gives every card a distinct look without an image fetch.
 */
export function gradientFor(seed: string): { from: string; to: string } {
  const palettes: Array<{ from: string; to: string }> = [
    { from: "#0f172a", to: "#475569" }, // slate
    { from: "#1e3a8a", to: "#3b82f6" }, // blue
    { from: "#831843", to: "#ec4899" }, // pink
    { from: "#064e3b", to: "#10b981" }, // emerald
    { from: "#7c2d12", to: "#f97316" }, // orange
    { from: "#581c87", to: "#a855f7" }, // purple
    { from: "#0c4a6e", to: "#0ea5e9" }, // sky
    { from: "#365314", to: "#84cc16" }, // lime
    { from: "#7f1d1d", to: "#ef4444" }, // red
    { from: "#1f2937", to: "#6366f1" }, // indigo
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return palettes[Math.abs(hash) % palettes.length];
}
