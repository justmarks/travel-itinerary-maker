# Mobile App — Deferred Work

Tracking items that didn't make the Phase 1 cut. Keep this file in sync as
work moves between phases.

## Phase 2 — Feature completeness for consumption

- [ ] **Costs sheet** — bottom sheet pulled up from a footer button on the
      carousel/feed; reuses `useTripCosts`; totals by currency + per-segment
      list.
- [ ] **Todos sheet** — same pattern; tap to toggle complete via
      `useUpdateTodo`; group by category.
- [ ] **Shared trip route** at `/m/shared?token=…` — same `MobileFrame`,
      no auth required, no write actions exposed.
- [ ] **iCal export** — small icon in the carousel header that triggers
      `client.exportIcal`. Uses the Web Share API on iOS for the
      "Add to Calendar" action sheet, falls back to a download on Android.
      *Deferred from Phase 1 to keep that PR scoped to navigation/auth/share.*
- [ ] **Native maps deep links** — `geo:` (Android), `maps://` (iOS),
      `https://maps.google.com` fallback. *Partially landed via the
      segment detail sheet's "Maps" button which opens Google Maps
      directly; still want the proper geo: / maps:// scheme detection.*
- [ ] **Long-trip day strip behaviour** — verify the auto-scroll-into-view
      chip selection still feels right at 14+ days.
- [ ] **Rich per-trip link previews** — `navigator.share` already passes
      a `text` field with title + dates, but the link-preview *card*
      receivers render is generic ("Travel Itinerary Maker / Auto-
      generated trip plans…") because static export bakes one set of OG
      tags into every page. Per-trip metadata needs a serverless OG
      endpoint (Cloudflare Worker / Vercel edge) that reads the trip ID
      from the URL, fetches the trip from the public-share API, and
      renders a custom OG image + meta tags. Out of scope for static GH
      Pages; revisit if we add a serverless layer.

## Phase 3 — Offline + PWA

- [ ] Install `@serwist/next` (or successor); generate service worker with
      stale-while-revalidate for static assets.
- [ ] Add TanStack Query persistence with `idb-keyval` so trip data
      survives offline.
- [ ] App manifest + icons + splash screens for installability.
- [ ] Subtle "Offline · cached copy" banner; per-trip "available offline"
      indicator.
- [ ] Static map snapshots (Google Static Maps API, ~$0.002/snapshot)
      cached to IndexedDB so day maps render offline. (Decision logged in
      the Phase 0 plan.)

## Phase 4 — Polish

- [ ] Accessibility audit: focus order, screen reader labels, all
      interactive elements ≥44pt.
- [ ] Code-split the Google Maps bundle on first map render.
- [ ] iOS Safari quirks: 100dvh instead of 100vh, safe-area insets.
- [ ] Verify GitHub Pages static export still passes.
