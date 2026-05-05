import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request CSP nonce middleware.
 *
 * Mozilla Observatory flags any CSP that includes `'unsafe-inline'`
 * in `script-src` because it neutralises the inline-script attack
 * surface that CSP is supposed to protect. Replacing `'unsafe-inline'`
 * with a per-request `'nonce-{value}'` directive closes that gap —
 * only scripts the server explicitly stamps with the matching nonce
 * are allowed to run.
 *
 * The flow:
 *   1. Generate a fresh 128-bit nonce on every request.
 *   2. Set it as the `x-nonce` request header. Next.js's renderer
 *      reads this header and automatically applies the nonce to
 *      every inline `<script>` it emits (hydration bootstrap, RSC
 *      flight payload, the `<Script>` component, next-themes' anti-
 *      flash inline). Server components can also read it via
 *      `headers().get('x-nonce')` if they need to stamp a custom
 *      inline script.
 *   3. Set the `Content-Security-Policy` response header with
 *      `'nonce-{value}' 'strict-dynamic'` so any script loaded by a
 *      nonce-trusted bootstrap is also trusted (this is how Next.js's
 *      hydration loads further chunks).
 *
 * Trade-offs accepted:
 *   - Pages that previously had Static Generation become dynamic.
 *     Cloudflare Pages (our deployment target) still serves them
 *     fast, but the CDN cache key changes per request.
 *   - `'unsafe-eval'` stays in the CSP for now — Google Maps JS
 *     compiles modules at runtime. Removing it would break the Map
 *     tab. Worth scoping per-route in a follow-up so marketing
 *     pages don't carry the laxer policy.
 *
 * The other site-wide security headers (Permissions-Policy, HSTS,
 * COOP/CORP, X-*) stay in `next.config.ts` — they don't vary per
 * request and are cheaper to apply at the edge config level.
 */

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

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // `'nonce-X'` allows scripts the server stamps; `'strict-dynamic'`
    // lets those trusted scripts load further scripts (Next.js's
    // hydration boot loads chunks dynamically). `'unsafe-eval'` is
    // required by the Google Maps JS API (it compiles its own
    // modules at runtime); remove if/when the map switches to a
    // server-rendered tile setup.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
      // `https:` and `http:` are fallbacks for browsers that don't
      // honor `'strict-dynamic'`. They're ignored by modern browsers
      // (which use the strict-dynamic directive) but keep the page
      // rendering on older ones.
      "https:",
      "http:",
    ],
    // Tailwind v4 emits inline `<style>` for view-transition / preflight
    // ordering, and Next.js inlines critical CSS — both still need
    // `'unsafe-inline'`. Mozilla's recommendation about
    // `'unsafe-inline'` specifically targets `script-src`; on
    // `style-src` it's far less dangerous.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": [
      "'self'",
      "data:",
      "https://cdn.jsdelivr.net",
      "https://fonts.gstatic.com",
    ],
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
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'", "https://accounts.google.com"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .concat("upgrade-insecure-requests")
    .join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  // Web Crypto's `getRandomValues` works in both the Edge runtime
  // (Cloudflare Pages) and Node 20+ (`next dev`). 128 bits is the
  // OWASP-recommended minimum for nonces; 256 doesn't add meaningful
  // security and bloats every page response.
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  const nonce = btoa(String.fromCharCode(...array));

  const csp = buildCsp(nonce);

  // Forward the nonce to downstream Server Components (and Next.js's
  // own renderer) via a request header. Next.js reads `x-nonce`
  // automatically and stamps every inline script + `<Script>` with
  // it; Server Components can read it via `headers().get('x-nonce')`.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  // Skip the API and Next's internal asset routes — neither serves
  // HTML that needs CSP. The `missing` block additionally excludes
  // prefetch requests (the router fetches RSC payloads in the
  // background, no point burning a fresh nonce on each).
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon\\.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
