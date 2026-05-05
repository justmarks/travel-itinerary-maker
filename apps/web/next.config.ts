import type { NextConfig } from "next";
import path from "path";
import pkg from "./package.json";

// ── Security headers ────────────────────────────────────────────
//
// All three site-wide security headers (CSP, Permissions-Policy,
// HSTS) are emitted from a single `headers()` route below so they
// stay in one place. The CSP is the load-bearing one — adjustments
// to third-party origins (analytics, maps, OAuth) live here.

// Origin of the backend API. The browser hits this directly from
// the trip pages, so it has to be in `connect-src`. Falls back to
// the dev server when no env override is set.
const API_ORIGIN = (() => {
  const raw =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3001";
  }
})();

// Per-directive allowlists. Keep each list narrow — wildcards are
// only used where the third-party documents that subdomains rotate
// (Sentry ingest, Google APIs).
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // `'unsafe-inline'` is required by Next.js's inline hydration
  // bootstrap (`__next_f.push(...)`). Upgrading to a per-request
  // nonce needs middleware that wraps every response, which would
  // disable static optimization — out of scope for this PR.
  // `'unsafe-eval'` is required by the Google Maps JS API (it
  // compiles its own modules at runtime).
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://maps.googleapis.com",
    "https://maps.gstatic.com",
    "https://va.vercel-scripts.com",
  ],
  // Tailwind v4 emits inline `<style>` for view-transition / preflight
  // ordering, and Next.js inlines critical CSS — both need
  // `'unsafe-inline'`.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  // `data:` covers the Inter glyphs that next/font inlines as base64
  // for the first-paint subset; `cdn.jsdelivr.net` carries the
  // Twemoji flag webfont loaded by country-flag-emoji-polyfill.
  "font-src": [
    "'self'",
    "data:",
    "https://cdn.jsdelivr.net",
    "https://fonts.gstatic.com",
  ],
  // Trip-card hero photos resolve to upload.wikimedia.org;
  // googleusercontent serves the user's profile picture in the
  // header menu; gstatic + maps.googleapis cover Google Maps tiles
  // and pin sprites.
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://upload.wikimedia.org",
    "https://*.wikipedia.org",
    "https://*.googleusercontent.com",
    "https://*.gstatic.com",
    "https://maps.googleapis.com",
  ],
  "connect-src": [
    "'self'",
    API_ORIGIN,
    "https://accounts.google.com",
    "https://*.googleapis.com",
    "https://en.wikipedia.org",
    "https://upload.wikimedia.org",
    "https://*.ingest.sentry.io",
    "https://*.vercel-insights.com",
  ],
  // Service worker registered at /sw.js — same-origin only.
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  // No third-party iframes embedded today; Google OAuth is a full
  // top-level redirect, not a popup. Keep `frame-src 'self'` so
  // future internal iframes work without policy churn.
  "frame-src": ["'self'"],
  // `frame-ancestors 'none'` is the modern replacement for the
  // legacy `X-Frame-Options: DENY` header — refuses to render the
  // site inside any iframe (clickjacking protection).
  "frame-ancestors": ["'none'"],
  // OAuth submits forms to accounts.google.com via top-level
  // navigation; allowlisted explicitly because the default
  // `form-action` derives from `default-src` which is 'self'.
  "form-action": ["'self'", "https://accounts.google.com"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
};

const CSP = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v.join(" ")}`)
  .concat("upgrade-insecure-requests")
  .join("; ");

// Restrictive Permissions-Policy — opt out of every powerful
// feature the app does not use. `interest-cohort=()` opts the
// site out of FLoC / Topics API ad-tracking cohorts.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=()",
  "battery=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "interest-cohort=()",
  "keyboard-map=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

// 1 year, all subdomains. `preload` is intentionally omitted —
// add it (and submit to hstspreload.org) once every itinly subdomain
// is verified HTTPS-only.
const HSTS = "max-age=31536000; includeSubDomains";

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "Strict-Transport-Security", value: HSTS },
  // Belt-and-suspenders alongside CSP `frame-ancestors 'none'`,
  // for legacy browsers that don't honor CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Prevents MIME-sniffing attacks where a browser executes a
  // user-uploaded .png as JavaScript because the response had no
  // explicit type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Strip Referer on cross-origin nav so the path of a private
  // share link doesn't leak to the destination site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Block other origins from loading this site's responses as
  // resources. This is the modern Spectre / cross-origin-read
  // mitigation — browsers check it before delivering a response
  // to a cross-origin embedder, regardless of whether ACAO is set.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Pair to CORP: isolates this document's window from cross-
  // origin popups so a `window.opener` reference can't be used
  // to read into the page from a third-party tab. Together with
  // CORP this gets us the "cross-origin isolated" baseline.
  // `same-origin-allow-popups` (rather than the strictest
  // `same-origin`) keeps Google OAuth's full-page redirect flow
  // working — the OAuth handler reopens itinly afterwards as a
  // top-level navigation, which COOP same-origin would sever.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // Explicitly pin Access-Control-Allow-Origin to the site's own
  // origin. Cloudflare Pages and various CDN intermediaries
  // sometimes inject `Access-Control-Allow-Origin: *` on static
  // asset responses; setting our own value overrides that default
  // and resolves the "very lax CORS policy" finding from
  // securityheaders.com / Roboshadow. The frontend HTML pages are
  // never legitimately fetched cross-origin (the only client is
  // the user's own browser hitting the same origin), so pinning
  // ACAO to our origin is functionally equivalent to having no
  // CORS at all but avoids the wildcard.
  {
    key: "Access-Control-Allow-Origin",
    value: process.env.NEXT_PUBLIC_SITE_URL || "https://itinly.app",
  },
];

// ── Cache-Control ───────────────────────────────────────────────
//
// Default for HTML / JSON responses: never cache. Trip pages,
// share links, and dialog state all carry user data that must
// not be served stale from intermediaries. The narrow exceptions
// — fingerprinted assets, public marketing files — declare their
// own caching policy via more-specific `headers()` entries.

const NO_STORE = "no-cache, no-store, must-revalidate";
// One year + immutable for fingerprinted assets that bake a
// content hash into their filename. They never change for a
// given URL; CDNs and browsers can cache them indefinitely.
const ASSET_IMMUTABLE = "public, max-age=31536000, immutable";
// One day for static public files whose URLs do NOT carry a
// content hash (favicon, manifest, robots, sitemap, icons).
// Long enough to amortise CDN trips, short enough that a typo
// fix is in users' browsers within a day.
const STATIC_PUBLIC = "public, max-age=86400";

const nextConfig: NextConfig = {
  // Suppress the default `X-Powered-By: Next.js` response header — it's
  // a small server-fingerprint leak with zero functional value. ZAP and
  // similar scanners flag it as info-level.
  poweredByHeader: false,
  // Cloudflare Pages serves the site at the project's root (or a custom
  // domain), so we no longer need GitHub Pages' `/travel-itinerary-maker`
  // basePath nor the static-export pipeline. The Edge runtime in
  // `app/shared/[token]/page.tsx` requires SSR.
  images: {
    // Keep unoptimised: we deploy to CF Pages and don't run Next's
    // optimiser server. Trip card hero images come from Wikipedia and
    // Unsplash and don't need transforming.
    unoptimized: true,
  },
  transpilePackages: ["@travel-app/shared", "@travel-app/api-client"],
  // Prevent Next.js from walking up to a parent lockfile (e.g. a global
  // package-lock.json in the user's home directory) and picking the wrong
  // workspace root. Explicitly anchor it to the monorepo root.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Surfaced in the UserMenu dropdown. Sourced from this package's version so
  // the version-bump workflow keeps it in sync with the rest of the project.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    // Order matters: Next.js applies every matching entry in order,
    // and a later entry's value for the same header key overrides
    // an earlier one. So the default `Cache-Control: no-store` lands
    // first, then more-specific paths override it.
    return [
      {
        source: "/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Cache-Control", value: NO_STORE },
        ],
      },
      {
        // Fingerprinted Next.js bundles + media. Filenames carry a
        // content hash (`/_next/static/chunks/abc123.js`), so an
        // unchanged URL guarantees unchanged bytes — cache forever.
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: ASSET_IMMUTABLE }],
      },
      {
        // Public marketing surfaces and crawler files.
        source: "/:path(robots\\.txt|sitemap\\.xml|manifest\\.json|favicon\\.ico|icon\\.svg|notification-badge\\.svg)",
        headers: [{ key: "Cache-Control", value: STATIC_PUBLIC }],
      },
      {
        // Service worker stays no-store: the browser's update
        // check on every page load only works if intermediaries
        // can't hand back a stale copy.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: NO_STORE }],
      },
    ];
  },
};

export default nextConfig;
