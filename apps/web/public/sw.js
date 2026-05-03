/**
 * itinly service worker.
 *
 * Goal: make the mobile site usable in airplane / no-signal conditions
 * for read-only consumption of a previously-loaded trip.
 *
 * Strategies:
 *  - App shell precache: a tiny set of routes is fetched on install so the
 *    app boots offline. We use `fetch` + `cache.put` instead of `cache.add`
 *    so we can drop responses that arrived via a redirect — Chromium
 *    refuses to serve `response.redirected === true` entries to a
 *    navigation request, which would otherwise show the browser's default
 *    "You're offline" page.
 *  - Same-origin GET navigations: network-first → exact-URL cache → loose
 *    (ignore querystring) cache → `/m` shell → synthetic offline page. We
 *    always return a real Response so Chrome's default offline screen
 *    never fires.
 *  - Next RSC payload fetches (the SPA-nav data layer, identified by the
 *    `text/x-component` Accept header or `?_rsc=` query param):
 *    network-first → cache. Cache key strips the `_rsc=` deploy-hash so a
 *    redeploy doesn't invalidate previously-visited routes.
 *  - Same-origin static assets (`/_next/static/*`, fonts, icons): cache-first.
 *  - Backend trip JSON (`/api/v1/trips...`, GET): network-first → cache.
 *    React Query handles freshness above this; we just keep the last good
 *    response around for offline boots.
 *  - Wikipedia/Wikimedia city images: stale-while-revalidate, capped at 60.
 *
 * Bump SW_VERSION when shipping a new shell or strategy change so old
 * caches get evicted on activate.
 */

const SW_VERSION = "v5";
const SHELL_CACHE = `itinly-shell-${SW_VERSION}`;
const RUNTIME_CACHE = `itinly-runtime-${SW_VERSION}`;
const TRIP_API_CACHE = `itinly-trip-api-${SW_VERSION}`;
const RSC_CACHE = `itinly-rsc-${SW_VERSION}`;
const IMAGE_CACHE = `itinly-images-${SW_VERSION}`;

const SHELL_URLS = ["/m", "/m/login", "/manifest.webmanifest", "/icon.svg"];
const NAV_FALLBACK_URL = "/m";

const IMAGE_CACHE_MAX_ENTRIES = 60;

/**
 * Minimal HTML shown only when both network and every cache layer have
 * missed — e.g. the user installed the PWA and immediately tried to
 * cold-launch a deep-link they've never visited online. Better than
 * Chrome's default offline screen because it stays branded and points
 * the user back to a known route.
 */
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>itinly — offline</title>
<style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #fafafa; color: #18181b; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 1.5rem; }
  .card { max-width: 24rem; text-align: center; }
  h1 { margin: 0 0 .5rem; font-size: 1.125rem; }
  p { margin: 0 0 1.25rem; color: #52525b; font-size: .875rem; line-height: 1.4; }
  a { display: inline-block; padding: .5rem 1.25rem; background: #18181b; color: #fafafa; border-radius: 9999px; text-decoration: none; font-weight: 500; font-size: .875rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #fafafa; }
    p { color: #a1a1aa; }
    a { background: #fafafa; color: #18181b; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>You're offline</h1>
    <p>This page hasn't been loaded on this device yet. Reconnect to load it, or open one of your previously-loaded trips.</p>
    <a href="/m">My trips</a>
  </div>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_URLS.map(async (url) => {
      try {
        // `redirect: "follow"` (the default) is fine here — the issue is
        // only that a Response with `redirected === true` can't be served
        // back to a navigation request. We re-wrap as a clean Response so
        // the redirect flag drops.
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          console.warn("[sw] precache miss", url, res.status);
          return;
        }
        const body = await res.clone().blob();
        const clean = new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
        await cache.put(url, clean);
      } catch (err) {
        console.warn("[sw] precache error", url, err);
      }
    }),
  );
}

self.addEventListener("activate", (event) => {
  const allowed = new Set([SHELL_CACHE, RUNTIME_CACHE, TRIP_API_CACHE, RSC_CACHE, IMAGE_CACHE]);
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

  // Next App Router RSC payload fetches. Triggered by client-side
  // navigation through `<Link>` (the dominant nav path on mobile). These
  // never hit the navigation handler below because they're regular fetch
  // requests, so without this branch a previously-visited trip wouldn't
  // be available offline — the navigation would silently fail and Next
  // would fall back to a hard nav, losing the cached state.
  if (isRscRequest(req, url)) {
    event.respondWith(rscHandler(req, url));
    return;
  }

  // Navigations: try network, fall back to cache, finally to /m shell, then
  // a synthetic offline page so Chrome never shows its default screen.
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

/**
 * Next App Router uses two signals for an RSC fetch:
 *   - `Accept: text/x-component` header
 *   - `?_rsc=<deploy-hash>` query param the runtime appends to bust caches
 *     between deploys
 * Either one is sufficient.
 */
function isRscRequest(req, url) {
  const accept = req.headers.get("Accept") || "";
  if (accept.includes("text/x-component")) return true;
  return url.searchParams.has("_rsc");
}

/**
 * Build a Request that's identical to the input but with the `_rsc=`
 * cache-buster query param stripped. We use this as the cache key so an
 * RSC payload cached on one deploy is still hit after a redeploy bumps
 * the hash. The actual server response (used for revalidation) still
 * uses the original URL with the hash.
 */
function rscCacheKey(req, url) {
  if (!url.searchParams.has("_rsc")) return req;
  const cleanUrl = new URL(url.toString());
  cleanUrl.searchParams.delete("_rsc");
  return new Request(cleanUrl.toString(), {
    method: req.method,
    headers: req.headers,
    mode: req.mode,
    credentials: req.credentials,
  });
}

async function rscHandler(req, url) {
  const cache = await caches.open(RSC_CACHE);
  const key = rscCacheKey(req, url);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(key, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw err;
  }
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
  // Try the network first so deploys propagate when online, but cache the
  // result for next time so even an unprecached deep-link survives a
  // single online visit before going dark.
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    return offlineNavigationFallback(req);
  }
}

async function offlineNavigationFallback(req) {
  // 1) Exact runtime cache hit (the user visited this URL while online).
  const runtime = await caches.open(RUNTIME_CACHE);
  const exact = await runtime.match(req);
  if (exact) return exact;

  // 2) Loose runtime hit — same path, different query string. Lets a
  //    re-launch into `/m/trip?id=X&v=carousel` reuse a previously-cached
  //    `/m/trip?id=X` response if Chrome dropped the v= param.
  const loose = await runtime.match(req, { ignoreSearch: true });
  if (loose) return loose;

  // 3) Precached shell — for any unknown route, serve the mobile shell so
  //    React can hydrate and route client-side based on the URL bar (which
  //    still reflects the requested URL).
  const shell = await caches.open(SHELL_CACHE);
  const shellMatch = await shell.match(NAV_FALLBACK_URL);
  if (shellMatch) return shellMatch;

  // 4) Last resort — branded offline page. Reached only on a true
  //    cold-launch where neither precache nor runtime cache has anything,
  //    e.g. immediately after install on a flaky connection.
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

async function trimCache(cacheName, maxEntries) {
  if (!maxEntries) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

// ─── Web Push ────────────────────────────────────────────────────────────────
//
// Payload shape (server-controlled, see NotificationSender):
//   { title: string, body: string, url?: string, tag?: string, data?: object }
//
// We always show *something* on a push event — Chrome will revoke the
// subscription if a push fires without a notification. When the payload
// can't be parsed we fall back to a generic banner so the user notices
// activity and can come investigate.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "itinly",
      body: event.data ? event.data.text() : "Trip activity",
    };
  }

  const title = payload.title || "itinly";
  const options = {
    body: payload.body || "",
    // Large icon shown inside the notification body — keeps the colour
    // brand mark since this surface preserves colour on every platform.
    // Appending `?v=${SW_VERSION}` makes Android treat each SW upgrade's
    // icon as a brand-new resource: defeats both our SW cache (URL is
    // the cache key) AND any OS-level bitmap cache Android keeps for
    // previously-rendered notification icons. Without this, a phone
    // that received notifications under the old artwork would keep
    // rendering the old bitmap even after the SW cache evicts.
    icon: `/icon.svg?v=${SW_VERSION}`,
    // Small icon shown in the Android status bar (next to the clock).
    // Android strips the badge to its alpha channel and tints the
    // shape with the system accent — `icon.svg` fills the whole canvas
    // with an opaque background, which Android rendered as a featureless
    // white square. `notification-badge.svg` keeps only the brand
    // silhouette opaque so Android can extract a recognisable shape.
    // Same versioning rationale as `icon` above.
    badge: `/notification-badge.svg?v=${SW_VERSION}`,
    tag: payload.tag,
    // Re-fire even when the same tag is already on screen so a second
    // share invite doesn't get silently swallowed by the first.
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/", ...(payload.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // If a tab's already on the target route, focus it instead of
      // opening a duplicate. We compare by URL prefix so query strings
      // don't break the match.
      for (const client of all) {
        try {
          const url = new URL(client.url);
          if (url.pathname === targetUrl || client.url.endsWith(targetUrl)) {
            return client.focus();
          }
        } catch {
          // Ignore non-URL clients
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// Some browsers fire `pushsubscriptionchange` when they rotate the
// endpoint (e.g. after a long offline period). The spec recommends
// re-subscribing automatically; we let the page do that on its next
// load by simply invalidating our cached subscription. The page-side
// `usePushSubscription` hook will detect the mismatch and re-register.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .getSubscription()
      .then(() => undefined)
      .catch(() => undefined),
  );
});
