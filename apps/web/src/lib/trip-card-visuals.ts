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
  // Returns the data even when `type === "disambiguation"` — callers
  // detect that case (`pickImageFromSummary` skips disambiguation
  // because it has no thumbnail) and can opt into walking the
  // disambiguation page's links via `fetchDisambiguationPlaceLinks`.
  return (await res.json()) as WikipediaSummary;
}

interface WikipediaLinksResponse {
  query?: {
    pages?: Record<
      string,
      {
        links?: Array<{ ns: number; title: string }>;
      }
    >;
  };
}

/**
 * Walk a Wikipedia disambiguation page's outbound links and return the
 * subset that match `^{query}, .*` — the canonical disambiguator for
 * geographic places (e.g. "Whistler" → "Whistler, British Columbia",
 * "Palm Desert" → "Palm Desert, California"). Filtering on this shape
 * keeps person and band entries out of the candidate list.
 *
 * Order is "as Wikipedia listed them," which is alphabetical for
 * generic disambiguation pages. Callers should still verify each
 * candidate has a thumbnail before using it (some tiny census-
 * designated places get a stub article with no image).
 */
interface WikipediaImagesResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{ thumburl?: string; descriptionurl?: string }>;
      }
    >;
  };
}

/**
 * Last-resort image lookup for articles whose `summary`/`pageimages`
 * endpoints don't surface a thumbnail despite the article actually
 * having usable images (Wikipedia's `pageimage` property is sometimes
 * unset even on well-illustrated articles — e.g. "Whistler, British
 * Columbia" has the Olympic Inukshuk statue as its lead image but
 * Wikipedia hasn't tagged it as the page image).
 *
 * Walks the article's image list via `generator=images` + `iiprop=url`,
 * filters out SVGs (almost always maps, location-marker overlays, or
 * Wikipedia chrome) and obvious icon files, returns the first
 * remaining JPEG/PNG. The first content image on a Wikipedia article
 * is reliably the lead image, so this is good enough.
 */
async function fetchFirstArticleImage(
  title: string,
): Promise<CityImage | undefined> {
  const url =
    `https://en.wikipedia.org/w/api.php` +
    `?action=query&format=json&generator=images&gimlimit=10` +
    `&prop=imageinfo&iiprop=url&iiurlwidth=400` +
    `&titles=${encodeURIComponent(title.replace(/\s+/g, "_"))}` +
    `&origin=*`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Api-User-Agent": "itinly (itinly.app)",
      },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as WikipediaImagesResponse;
    const pages = Object.values(data.query?.pages ?? {});
    // The pages collection from `generator=images` is keyed by image
    // pageid in arbitrary order, but Wikipedia's documented behaviour
    // is to surface them in article-occurrence order — first match is
    // usually the infobox / lead image. We further filter to sane
    // content image types and skip Wikipedia chrome.
    for (const page of pages) {
      const fileTitle = (page.title ?? "").toLowerCase();
      // Skip SVGs (location maps, flags, icon overlays) and files whose
      // names betray they're chrome / generic icons rather than the
      // lead photo.
      if (fileTitle.endsWith(".svg")) continue;
      if (
        /(logo|icon|commons-?logo|edit-?icon|location_?map|locator|flag_of)/.test(
          fileTitle,
        )
      ) {
        continue;
      }
      const info = page.imageinfo?.[0];
      if (info?.thumburl) {
        return {
          url: info.thumburl,
          pageUrl: info.descriptionurl,
        };
      }
    }
    return undefined;
  } catch (err) {
    console.warn(
      `[trip-card-visuals] Wikipedia images fallback failed for "${title}":`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

async function fetchDisambiguationPlaceLinks(title: string): Promise<string[]> {
  const url =
    `https://en.wikipedia.org/w/api.php` +
    `?action=query&format=json&prop=links&pllimit=50&plnamespace=0` +
    `&titles=${encodeURIComponent(title.replace(/\s+/g, "_"))}` +
    // origin=* permits the CORS request from arbitrary browser origins.
    `&origin=*`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Api-User-Agent": "itinly (itinly.app)",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as WikipediaLinksResponse;
    const pages = data.query?.pages ?? {};
    const links = Object.values(pages)[0]?.links ?? [];
    const placePrefix = `${title}, `;
    return links
      .map((l) => l.title)
      .filter((t) => t.startsWith(placePrefix));
  } catch (err) {
    console.warn(
      `[trip-card-visuals] Wikipedia disambiguation links failed for "${title}":`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
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

      // Track whether any of the lookups landed on a disambiguation
      // page so step 3 can walk its place-link list.
      let disambigTitle: string | undefined;

      // 1) Try the raw title — fast path for unambiguous cities.
      const directSummary = await fetchSummary(cityHead);
      const direct = pickImageFromSummary(directSummary);
      if (direct) return direct;
      if (directSummary?.type === "disambiguation") {
        disambigTitle = cityHead;
      }

      // 2) Search for the article. Use the country (if known) as a hint
      //    so "Palm Desert" lands on "Palm Desert, California" rather
      //    than disambiguating to a generic landform.
      const matchedTitle = await searchForArticleTitle(cityHead, country);
      if (matchedTitle && matchedTitle !== cityHead) {
        const searchedSummary = await fetchSummary(matchedTitle);
        const searched = pickImageFromSummary(searchedSummary);
        if (searched) return searched;
        if (searchedSummary?.type === "disambiguation") {
          disambigTitle = matchedTitle;
        }
      }

      // 3) Disambiguation walk. When step 1 or 2 landed on a
      //    disambiguation page (e.g. "Whistler" → the disambiguation
      //    page that lists Whistler, British Columbia + Whistler,
      //    Alabama + people named Whistler + …), pull the
      //    `^{title}, *` candidates and try each. Capped at 5 to
      //    bound the worst-case cost — beyond that we'd be burning
      //    network for a tiny census-designated place that probably
      //    has no image anyway.
      let disambigCandidates: string[] = [];
      if (disambigTitle) {
        disambigCandidates = (
          await fetchDisambiguationPlaceLinks(disambigTitle)
        ).slice(0, 5);
        for (const candidate of disambigCandidates) {
          const candidateImg = pickImageFromSummary(
            await fetchSummary(candidate),
          );
          if (candidateImg) return candidateImg;
        }
      }

      // 4) Deeper image fallback. Wikipedia's `pageimage` property
      //    isn't always populated even on well-illustrated articles
      //    (e.g. "Whistler, British Columbia" has the Olympic Inukshuk
      //    statue as its lead image, but the summary endpoint returns
      //    no thumbnail). Walk the article's image list directly via
      //    `prop=images` and pick the first content image. We try this
      //    on the disambiguation candidates first (most likely to be
      //    the city the user meant), then fall back to the matched
      //    search title.
      const imageWalkTargets = [
        ...disambigCandidates,
        ...(matchedTitle ? [matchedTitle] : []),
      ].filter(Boolean);
      for (const target of imageWalkTargets.slice(0, 3)) {
        const found = await fetchFirstArticleImage(target);
        if (found) return found;
      }

      // 5) Country fallback so cruise stops and small towns still show
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
