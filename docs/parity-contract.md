# Desktop ↔ Mobile parity contract

CLAUDE.md mandates that every UX change land in both the desktop site
(`apps/web/src/app/trips/...`) and the mobile site (`apps/web/src/app/m/...`)
in the same PR. This document is the standing checklist of which file
pairs implement each surface — use it when reviewing a PR that touches
any of the listed surfaces, and update it when a new parallel surface is
introduced.

If the parallel implementation has been collapsed into a shared module
(a hook, a util, a typed enumeration), that's the strongest defence
against drift and the third column captures it.

## Surface inventory

| Surface | Desktop | Mobile | Shared / contract |
|---|---|---|---|
| Trip list | `app/trips/page.tsx`, `components/trip-list.tsx`, `components/trip-card.tsx` | `app/m/page.tsx` | `lib/trip-buckets.ts` (Now/Upcoming/Past grouping), `hooks/use-trip-permission.ts` |
| Trip detail | `app/trips/trip-detail-client.tsx`, `components/itinerary-day.tsx` | `app/m/trip/page.tsx`, `components/mobile/mobile-feed-view.tsx` | `@travel-app/shared` `SEGMENT_LABELS` + `SEGMENT_TOKEN_FAMILY` drive both segment configs |
| Segment add/edit form | `components/add-segment-dialog.tsx`, `components/edit-segment-dialog.tsx`, `components/segment-form-fields.tsx` | `components/mobile/mobile-segment-form-sheet.tsx` | `@travel-app/shared` validator (`createSegmentSchema`, `updateSegmentSchema`) is the single source of truth for field shape |
| Segment detail | `components/itinerary-day.tsx` (`SegmentRow`) | `components/mobile/mobile-segment-detail-sheet.tsx` | Both read `SEGMENT_LABELS` from `@travel-app/shared` |
| Share dialog | `components/share-trip-dialog.tsx` | `components/mobile/mobile-share-sheet.tsx` | `lib/api-error.ts` (`describeError`, `toastMutationError`), `lib/share-activity.ts` |
| Auto-share rules | `components/auto-share-rules-panel.tsx` | `components/mobile/mobile-auto-share-sheet.tsx` | `@travel-app/api-client` hook set |
| Email scan | `components/email-scan-dialog.tsx` | `components/mobile/mobile-email-scan-sheet.tsx` | `@travel-app/api-client` hook set; `lib/oauth.ts` for Gmail link |
| Todos | `components/trip-todos.tsx` (with `showSuggestButton`) | `components/mobile/mobile-todos-sheet.tsx`, `components/mobile/mobile-todo-form-sheet.tsx` | **Known gap:** desktop exposes "Suggest meals"; mobile does not. |
| Costs | `components/trip-costs.tsx` | `components/mobile/mobile-costs-sheet.tsx` | `costCategoryLabel(category)` from `@travel-app/shared` (single label map) |
| Trip history | `components/trip-history.tsx` | `components/mobile/mobile-history-sheet.tsx` | — |
| Timeline view | `components/timeline-view.tsx`, `components/timeline-shared.ts` | `components/mobile/mobile-timeline-view.tsx` | `timeline-shared.ts` (`CATEGORY_TOKEN`, `extractHotels`, `sortByTime`) |
| Calendar sync | `components/(via desktop trip-detail)` | `components/mobile/mobile-calendar-sync-sheet.tsx` | `server/services/google-calendar.ts` (server-side) |
| Map view | `components/map-view.tsx` | `components/mobile/mobile-day-map.tsx`, `components/mobile/mobile-full-map-sheet.tsx` | `lib/category-pin-colors.ts` |
| Shared-trip viewer | `app/shared/[token]/shared-trip-client.tsx` | `app/m/shared/[token]/shared-trip-client.tsx` | `hooks/use-share-link-owner-redirect.ts` (both call) |
| Permission gating | All desktop pages | All mobile pages | `hooks/use-trip-permission.ts` (both call) |

## Conventions reviewers should check

When a PR touches any surface above, verify:

1. **Both columns changed.** If only one file in a row is modified, the PR
   description should explain why. The single-shared-module column is the
   green flag — if the change went into a hook/util/enumeration, the
   change applies to both surfaces automatically.
2. **Mutation toasts use `toastMutationError(verb)`** from
   `@/lib/api-error`. Don't reach for `toast.error(...)` directly; the
   helper enforces the `"Couldn't <verb>"` copy AND the `describeError`
   description in one call.
3. **Errors route via `describeError`** for any inline error display
   (`setError(...)`) so users see the server's validator-issue message,
   not a generic `Error.message`.
4. **Segment-type extensions** added in `packages/shared/src/types/trip.ts`
   automatically force a label and token-family entry in
   `segment-config.ts` (TypeScript-enforced `Record<SegmentType, ...>`).
   The desktop and mobile icon maps will fail to compile if a new type
   isn't given an icon.
5. **Cost categories** flow through `costCategoryLabel(category)` from
   `@travel-app/shared`. Don't introduce a local `CATEGORY_LABELS` table.
6. **Design tokens.** Status pills, segment pills, kicker eyebrows, and
   semantic colors use the `--seg-*` / `--status-*` / `--todo-*` /
   `--cat-*` tokens or the `text-kicker` utility (see CLAUDE.md). Raw
   Tailwind color utilities (`bg-amber-50`, `text-blue-600`) are
   disallowed for themed surfaces; they're allowed only when the
   surface beneath is itself fixed-color (a photo overlay, a Google
   Maps InfoWindow's hard-coded white background, a saturated rail
   that doesn't theme-invert) and the existing convention uses them.

## Known parity gaps

These intentionally diverge or are pending follow-up:

- **"Suggest meals" affordance is desktop-only.** Mobile todos sheet
  has no equivalent entry point. Pending product decision.
- **Share dialog vs. share sheet** picker visual (radio buttons vs.
  pills) is intentional form-factor divergence, not a parity bug.
- **Shared-trip viewer read-only** is enforced by different mechanisms
  (desktop passes `readOnly` to `ItineraryDay`; mobile relies on the
  public viewer not exposing edit controls). Same end-state, different
  code path.
