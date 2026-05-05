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
];

const nextConfig: NextConfig = {
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
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
