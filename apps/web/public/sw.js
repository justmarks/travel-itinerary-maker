/**
 * itinly service worker.
 *
 * Goal: make the mobile site usable in airplane / no-signal conditions
 * for read-only consumption of a previously-loaded trip.
 *
 * Strategies:
 *  - App shell precache: a tiny set of routes is fetched on install so the
 *    app boots offline. The HTML response itself is what we need cached;
 *    Next emits hashed JS chunks that get picked up via runtime cache below.
 *  - Same-origin GET navigations: network-first → cache → offline fallback.
 *  - Same-origin static assets (`/_next/static/*`, fonts, icons): cache-first.
 *  - Backend trip JSON (`/api/v1/trips...`, GET): network-first → cache.
 *    React Query handles freshness above this; we just keep the last good
 *    response around for offline boots.
 *  - Wikipedia/Wikimedia city images: stale-while-revalidate, capped at 60.
 *
 * Bump SW_VERSION when shipping a new shell or strategy change so old
 * caches get evicted on activate.
 */

const SW_VERSION = "v1";
const SHELL_CACHE = `itinly-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `itinly-runtime-${SW_VERSION}`;
const TRIP_API_CACHE = `itinly-trip-api-${SW_VERSION}`;
const IMAGE_CACHE = `itinly-images-${SW_VERSION}`;

const SHELL_URLS = ["/m", "/m/login", "/manifest.webmanifest", "/icon.svg"];

const IMAGE_CACHE_MAX_ENTRIES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // `addAll` aborts on any 4xx/5xx; use individual adds so a missing
        // route doesn't block the install.
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(url).catch(() => {
              // Best-effort precache; log to console for debugging.
              console.warn("[sw] precache miss", url);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const allowed = new Set([SHELL_CACHE, RUNTIME_CACHE, TRIP_API_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("itinly-") && !allowed.has(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Allow the page to ask the active SW to take over immediately after an
 * update — paired with a `registration.waiting.postMessage("SKIP_WAITING")`
 * call from the registrar.
 */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Backend trip JSON — only cache successful GETs to authenticated trip
  // endpoints. We deliberately scope to `/trips` so we don't cache email
  // scan results (large + only useful when online).
  if (isTripApi(url)) {
    event.respondWith(networkFirst(req, TRIP_API_CACHE));
    return;
  }

  // Wikipedia city images — cache-first with background revalidate.
  if (isWikimediaImage(url)) {
    event.respondWith(staleWhileRevalidate(req, IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES));
    return;
  }

  // Same-origin only beyond this point.
  if (url.origin !== self.location.origin) return;

  // Next.js hashed assets — content-addressed, safe to cache forever.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Navigations: try network, fall back to cache, finally to /m shell.
  if (req.mode === "navigate") {
    event.respondWith(navigationHandler(req));
    return;
  }

  // Other same-origin GETs (icons, manifest, fonts) — cache-first.
  if (req.destination === "image" || req.destination === "font" || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
});

function isTripApi(url) {
  // Matches both same-origin proxied calls and direct calls to the Railway
  // backend; we identify by path segment + GET above.
  return /\/api\/v1\/trips(\/|$|\?)/.test(url.pathname);
}

function isWikimediaImage(url) {
  return (
    url.hostname === "upload.wikimedia.org" ||
    url.hostname.endsWith(".wikipedia.org")
  );
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone()).then(() => trimCache(cacheName, maxEntries));
      }
      return res;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

async function navigationHandler(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Mobile shell as last-resort fallback for offline navigations.
    const shellCache = await caches.open(SHELL_CACHE);
    const shell = await shellCache.match("/m");
    if (shell) return shell;
    throw err;
  }
}

async function trimCache(cacheName, maxEntries) {
  if (!maxEntries) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}
