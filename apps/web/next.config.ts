import type { NextConfig } from "next";
import path from "path";
import pkg from "./package.json";

// ── Security headers ────────────────────────────────────────────
//
// **CSP lives in `src/middleware.ts`**, not here. The CSP needs a
// per-request nonce so it can drop `'unsafe-inline'` from
// `script-src` (Mozilla Observatory red flag), and per-request
// values can only come from middleware. Everything else — values
// that don't change per request — stays in this file.

// Restrictive Permissions-Policy — opt out of every powerful
// feature the app does not use. `interest-cohort=()` opts the
// site out of FLoC / Topics API ad-tracking cohorts.
//
// `ambient-light-sensor` and `battery` were intentionally dropped:
// Chrome doesn't recognize either feature name and emits
// `Error with Permissions-Policy header: Unrecognized feature: 'X'`
// on every navigation. The Battery Status API was un-shipped from
// Chromium years ago and the Ambient Light Sensor never reached
// stable. Adding them back when the spec catches up is one-line.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
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
  // Completes the cross-origin-isolated baseline: blocks the page
  // from loading any cross-origin resource that hasn't opted in
  // via CORP. `credentialless` is the lighter-weight variant of
  // `require-corp` — it strips credentials (cookies / auth
  // headers) on cross-origin sub-resource requests instead of
  // demanding every third party serve a CORP header. Lets Google
  // Maps tiles, Wikipedia images, and fonts.gstatic.com keep
  // working without forcing those parties to opt in.
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
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

const NO_STORE = "no-cache, no-store, must-revalidate";
const ASSET_IMMUTABLE = "public, max-age=31536000, immutable";
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
    return [
      {
        source: "/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Cache-Control", value: NO_STORE },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: ASSET_IMMUTABLE }],
      },
      {
        source: "/:path(robots\\.txt|sitemap\\.xml|manifest\\.json|favicon\\.ico|icon\\.svg|notification-badge\\.svg)",
        headers: [{ key: "Cache-Control", value: STATIC_PUBLIC }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: NO_STORE }],
      },
    ];
  },
};

export default nextConfig;
