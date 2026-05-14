import type { Metadata } from "next";
import Link from "next/link";
import { AppLogo } from "@/components/app-logo";

export const metadata: Metadata = {
  title: "Release notes — itinly",
  description:
    "What's new in itinly. Per-version release notes, latest first.",
};

export default function ReleaseNotesPage(): React.JSX.Element {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <AppLogo className="h-6 w-6" />
          <span className="font-semibold">itinly</span>
        </Link>

        <article className="space-y-10">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Release notes</h1>
            <p className="text-sm text-muted-foreground">
              What&apos;s new in itinly, latest first.
            </p>
          </header>

          <section className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">
                v1.1.0 — Microsoft + Outlook, end to end
              </h2>
              <p className="text-sm text-muted-foreground">May 10, 2026</p>
            </header>

            <p>
              The 1.1 release is mostly <strong>plumbing under the
              floorboards</strong> — but the floorboards are now sturdy enough
              to support Outlook + Microsoft accounts as first-class citizens
              alongside Google. Sign in with either provider, scan either
              inbox, sync to either calendar, and link both to the same
              account if you want to mix them.
            </p>

            <Subsection title="Multi-provider, end to end">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Sign in with Microsoft or Google</strong> via
                  Supabase Auth. Both flows force the account picker so you
                  never get silently signed in as the wrong identity.
                </li>
                <li>
                  <strong>Outlook email scan</strong> alongside Gmail — point
                  at a Mail folder (or nested folder like{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Inbox &gt; Travel
                  </code>
                  ), the same Claude parser pulls flights, hotels, and
                  reservations out. Inbox-only or all-mail toggle on both
                  sides.
                </li>
                <li>
                  <strong>Outlook Calendar sync</strong> alongside Google
                  Calendar — push segments, all-day hotel blocks, IANA-typed
                  flight events, and re-sync / unsync, with parity across
                  desktop and mobile.
                </li>
                <li>
                  <strong>Link multiple accounts</strong> on{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /settings/account
                  </code>{" "}
                  — one Google + one Microsoft identity, with separate Mail +
                  Calendar capability rows per provider. Disconnect cascades
                  cleanly: unlinking a sign-in identity also removes its
                  Mail / Calendar rows after an &ldquo;are you sure&rdquo;
                  confirm.
                </li>
                <li>
                  <strong>Inline provider picker</strong> on calendar + email
                  sync dialogs when you&apos;ve connected more than one —
                  defaults to your most-recently-used and remembers
                  per-feature.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Backend rebuilt on Supabase">
              <p className="text-sm text-muted-foreground">
                The product looks the same; underneath, it&apos;s a different
                system.
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Storage moved from Google Drive to Supabase
                  Postgres.</strong>{" "}
                  Trips, segments, todos, history, share-link metadata, push
                  subscriptions, and OAuth refresh tokens now live in
                  row-level-security-gated Postgres tables — not in a per-user
                  Drive folder.
                </li>
                <li>
                  <strong>Token refresh on the server</strong> — short-lived
                  access tokens for Gmail, Microsoft Graph, and both calendars
                  are minted from encrypted refresh tokens on demand, so a
                  long-tabbed-open session doesn&apos;t fall over silently.
                </li>
                <li>
                  <strong>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      InvalidAuthError
                    </code>
                  </strong>{" "}
                  as a typed signal across every connector — a revoked-at-
                  Google or scope-stripped token surfaces a specific 4xx that
                  the UI maps to the right reconnect screen, not a generic
                  500.
                </li>
                <li>
                  <strong>Storage + connector contract tests</strong> —{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    SupabaseStorage
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    InMemoryStorage
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    GoogleCalendarConnector
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    MicrosoftCalendarConnector
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    GmailEmailConnector
                  </code>
                  , and{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    MicrosoftEmailConnector
                  </code>{" "}
                  all run the same shared test suites, so the two providers
                  and the two storage backends can&apos;t drift apart.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Email scan polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Live progress</strong> — &ldquo;Found N emails →
                  Parsing X of M&rdquo; as the scan runs, instead of a single
                  spinner.
                </li>
                <li>
                  <strong>Multi-trip auto-clustering</strong> on desktop —
                  scanning an inbox that spans several trips now groups
                  proposals by destination / dates instead of dumping a flat
                  list.
                </li>
                <li>
                  <strong>Better placeholder handling</strong> — TBD /
                  open-date items are skipped silently instead of producing
                  zero-day &ldquo;trips&rdquo;.
                </li>
                <li>
                  <strong>Layover-aware titles</strong> — a SFO → NRT → BKK
                  booking proposes &ldquo;Bangkok&rdquo;, not
                  &ldquo;Tokyo&rdquo;.
                </li>
                <li>
                  <strong>Provider + account stored on each parsed email</strong>{" "}
                  so re-scans don&apos;t double-process the same thread across
                  accounts.
                </li>
                <li>
                  <strong>Per-folder Outlook listing</strong> including nested
                  folders, so{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Inbox &gt; Travel &gt; 2026
                  </code>{" "}
                  is reachable.
                </li>
                <li>
                  <strong>Anthropic 429 + Microsoft{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      MailboxConcurrency
                    </code>{" "}
                    retry</strong>{" "}
                  so a transient upstream blip doesn&apos;t fail the whole
                  scan.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Calendar sync polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Provider-aware dialogs</strong> that survive the
                  dropdown-menu closing, no overlap, no mid-flow remount.
                </li>
                <li>
                  <strong>Orphaned-event reuse</strong> on Outlook — if a
                  calendar event lost its segment link, the next sync rebinds
                  instead of duplicating.
                </li>
                <li>
                  <strong>Time-zone correctness</strong> verified by
                  wire-format tests: flights carry per-endpoint IANA zones,
                  hotels stay all-day, update-resync preserves the
                  event&apos;s existing extended properties.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Mobile">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Microsoft + Outlook everywhere</strong> — mobile
                  scan sheet, mobile calendar sync sheet, and the
                  account-settings panel all carry the same multi-provider
                  affordances as desktop.
                </li>
                <li>
                  <strong>Email-scan sheet</strong> surfaces partial-results
                  banners and stale-token recovery as step transitions, not
                  silent failures.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Trust and polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Account settings page</strong> at{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /settings/account
                  </code>{" "}
                  — see linked identities + capability rows, with
                  primary-email sort and live cross-panel state refresh.
                </li>
                <li>
                  <strong>Initials avatar fallback</strong> for accounts
                  without a provider photo; Microsoft Graph photo support
                  added for Microsoft sign-in.
                </li>
                <li>
                  <strong>Diagnostic logging gated behind{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      DEBUG_EMAIL_SCAN
                    </code>{" "}
                    /{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      DEBUG_CONNECTIONS
                    </code>{" "}
                    /{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      DEBUG_CALENDAR
                    </code>
                  </strong>{" "}
                  — production Railway logs are quiet by default; real
                  anomalies still always surface.
                </li>
                <li>
                  <strong>Hardened token writes</strong> — the server now
                  rejects a Google-shaped token written to a Microsoft row
                  (and vice versa) instead of silently corrupting the
                  connection.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Under the hood">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Workspace packages renamed</strong> from{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    @travel-app/*
                  </code>{" "}
                  →{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    @itinly/*
                  </code>{" "}
                  (shared, api-client, server, web) with a one-shot
                  localStorage key migration so existing browser state copies
                  forward.
                </li>
                <li>
                  <strong>Node ≥ 22.13</strong> required (pnpm 11&apos;s
                  loader depends on{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    node:sqlite
                  </code>
                  ).
                </li>
                <li>
                  <strong>Vercel build config</strong> is now in a checked-in{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    vercel.json
                  </code>{" "}
                  instead of the dashboard UI.
                </li>
                <li>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    pnpm update-test-count
                  </code>{" "}
                  keeps the README test count fresh;{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    pnpm check-test-count
                  </code>{" "}
                  runs in CI so it can&apos;t drift.
                </li>
                <li>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    server/.env.example
                  </code>{" "}
                  audited + split — frontend-only{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    NEXT_PUBLIC_*
                  </code>{" "}
                  vars moved to{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    apps/web/.env.example
                  </code>
                  , the long-dead{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    STORAGE_BACKEND=drive
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    STORAGE_POSTGRES_USERS
                  </code>{" "}
                  paths removed.
                </li>
                <li>
                  <strong>DriveStorage path fully removed</strong> (Phase 6 of
                  the backend-migration plan) —{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    mode: &quot;drive&quot;
                  </code>
                  , the per-user Drive folder layout, and the partial Drive →
                  Postgres importer are all gone from the tree.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Thanks">
              <p>
                The Drive era was good; the Postgres era is better. Onward.
              </p>
            </Subsection>
          </section>

          <section className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">
                v1.0.0 — itinly is 1.0
              </h2>
              <p className="text-sm text-muted-foreground">May 9, 2026</p>
            </header>

            <p>
              A year of work, dozens of releases, and a few hundred PRs later
              — itinly hits <strong>1.0</strong>. Sign in with Google or
              Microsoft, point it at your Gmail or Outlook inbox, and get a
              clean day-by-day itinerary back in seconds. The mobile site
              installs as a PWA and reads offline, and you can sync the
              whole trip to Google or Outlook Calendar with one tap.
            </p>

            <Subsection title="Plan a trip">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Day-by-day view</strong> with inline segment
                  editing, per-segment costs, and confirmation codes
                </li>
                <li>
                  <strong>Timeline view</strong> — Hipmunk-style Gantt grid
                  with swimlane / chronological toggle, hotels rendered as
                  spanning bars, prints cleanly
                </li>
                <li>
                  <strong>Map view</strong> — hotels, dining, activities, and
                  transport endpoints as pins on Google Maps; KML export for
                  Google My Maps
                </li>
                <li>
                  <strong>Flight endpoints by IATA</strong> — typeahead over
                  1,178 commercial airports (search by code, city, name, or
                  alias); auto-fills titles like{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    JFK → NRT (JL 5)
                  </code>
                </li>
                <li>
                  <strong>Embedded costs</strong> + dedicated Costs tab;
                  categorized <strong>TODO</strong> tracking (meals /
                  activities / research / logistics)
                </li>
              </ul>
            </Subsection>

            <Subsection title="Auto-extract from email">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Gmail scan</strong> — point at a label, Claude
                  parses confirmations into flights, hotels, restaurants,
                  transport
                </li>
                <li>
                  <strong>Email file import</strong> — paste or upload an{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    .html
                  </code>{" "}
                  /{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    .eml
                  </code>{" "}
                  for non-Gmail users
                </li>
                <li>
                  <strong>XLSX import</strong> — one-shot import a complete
                  trip from a OneNote-exported workbook (auto-detects column
                  layouts, attaches Costs sheet entries to lodging segments)
                </li>
              </ul>
            </Subsection>

            <Subsection title="Share, sync, export">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Per-trip share links</strong> with configurable
                  visibility (costs, TODOs)
                </li>
                <li>
                  <strong>Auto-share rules</strong> — share every existing
                  and future trip with someone in one tap
                </li>
                <li>
                  <strong>Google Calendar sync</strong> — push segments to
                  any writable calendar; hotels and car rentals become
                  all-day events; flights and trains carry per-city IANA time
                  zones; re-sync updates, unsync removes (with a choice to
                  delete or just unlink); available on desktop{" "}
                  <strong>and</strong> mobile
                </li>
                <li>
                  <strong>Export</strong> as Markdown, OneNote-compatible
                  HTML, PDF, or <strong>iCal (.ics)</strong> with VTIMEZONE
                  blocks for correct DST in Outlook and overnight-flight
                  handling
                </li>
              </ul>
            </Subsection>

            <Subsection title="Mobile (/m)">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  End-to-end planning on mobile — create trips, edit
                  metadata, add / edit / delete segments, edit day cities
                </li>
                <li>
                  <strong>Mobile email scan sheet</strong> — Gmail → Claude →
                  review → apply, with proposals for new trips when segments
                  don&apos;t match an existing trip
                </li>
                <li>
                  <strong>Map view</strong> and{" "}
                  <strong>timeline view</strong> with rotation support
                </li>
                <li>
                  <strong>Installable PWA</strong> — add to home screen on
                  Android / iOS, launch standalone, read previously-loaded
                  trips offline (mobile trip list dims trips not loaded on
                  this device when offline)
                </li>
                <li>
                  <strong>Calendar sync</strong> and <strong>share</strong>{" "}
                  parity with desktop
                </li>
              </ul>
            </Subsection>

            <Subsection title="Trust and polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Trip history (audit log)</strong> — every change
                  recorded in an append-only History tab (segments added /
                  edited / deleted, todos checked, dates rolled, day cities
                  edited, field-level diffs, shares created / revoked, XLSX
                  or email-scan imports). Reverse-chrono, grouped by day,
                  capped at 500 entries per trip. Available to owners and
                  contributors.
                </li>
                <li>
                  <strong>Dark mode</strong> — Light / Dark / System toggle
                  on desktop + mobile, follows OS preference, persists across
                  sessions
                </li>
                <li>
                  <strong>Demo mode</strong> at{" "}
                  <a
                    href="https://itinly.app/?demo=true"
                    className="underline underline-offset-4 hover:opacity-80"
                  >
                    itinly.app/?demo=true
                  </a>{" "}
                  — try it without signing in
                </li>
                <li>
                  <strong>In-app confirm dialogs</strong> (no more native{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    window.confirm
                  </code>
                  ); first-time onboarding hints; dismissible intro tour on
                  first sign-in
                </li>
                <li>
                  <strong>Optimistic mutations + Sonner toasts</strong> on
                  every user-triggered action
                </li>
                <li>
                  <strong>Locked brand palette</strong> with WCAG AA-verified
                  contrast across all token pairings
                </li>
              </ul>
            </Subsection>

            <Subsection title="Under the hood">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Next.js 15 + React 19 + TailwindCSS 4 + ShadCN UI on the
                  frontend
                </li>
                <li>
                  Express 5 + TypeScript on the backend; managed Postgres
                  (Supabase) for trip data with per-user row-level security
                </li>
                <li>
                  Claude API (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    claude-sonnet-4-6
                  </code>
                  ) for email parsing
                </li>
                <li>pnpm 10 monorepo orchestrated by Turborepo</li>
                <li>
                  Google OAuth (auth-code + PKCE), with Gmail split onto a
                  separate OAuth client to keep the primary client off CASA
                  review
                </li>
                <li>
                  Sentry on both web and server; per-user / per-trip log
                  tagging on email-scan, calendar-sync, and trip routes
                </li>
                <li>
                  Per-request CSP nonces, rate-limited auth + shared routes,
                  pinned{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Access-Control-Allow-Origin
                  </code>
                </li>
                <li>
                  Hosted on Vercel (web) + Railway (API) + Upstash Redis
                  (share tokens) — all on free tiers
                </li>
              </ul>
            </Subsection>

            <Subsection title="Recent fixes since 0.81.0">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Mobile share supports an optional recipient email (
                  <PrLink number={236} />)
                </li>
                <li>
                  Installed PWA rotates with the device; iPad portrait routes
                  to{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /m
                  </code>{" "}
                  (<PrLink number={238} />, <PrLink number={234} />)
                </li>
                <li>
                  Mobile landscape timeline expands edge-to-edge; row labels
                  stay on a single line (<PrLink number={240} />,{" "}
                  <PrLink number={241} />)
                </li>
                <li>
                  Slash-split city display + date range polish on mobile trip
                  header (<PrLink number={239} />)
                </li>
                <li>
                  Auto-share rules + share / trip-list / auth polish (
                  <PrLink number={247} />)
                </li>
                <li>
                  Version-bump workflow tolerates commit messages with shell
                  metachars (<PrLink number={248} />)
                </li>
                <li>
                  Use Railway&apos;s documented{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    [skip-deploy]
                  </code>{" "}
                  marker on auto-bump commits (<PrLink number={249} />)
                </li>
              </ul>
            </Subsection>

            <Subsection title="Thanks">
              <p>
                Built on Claude Code with a lot of iteration, a lot of
                mobile-portrait testing, and an unreasonable number of
                segment-color decisions. Onward to 1.x.
              </p>
            </Subsection>
          </section>
        </article>

        <footer className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
          <Link
            href="/welcome"
            className="underline underline-offset-4 hover:opacity-80"
          >
            About itinly
          </Link>
          <Link
            href="/privacy"
            className="underline underline-offset-4 hover:opacity-80"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="underline underline-offset-4 hover:opacity-80"
          >
            Terms
          </Link>
          <a
            href="https://github.com/justmarks/itinly/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:opacity-80"
          >
            All releases on GitHub
          </a>
        </footer>
      </div>
    </main>
  );
}

function Subsection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function PrLink({ number }: { number: number }): React.JSX.Element {
  return (
    <a
      href={`https://github.com/justmarks/itinly/pull/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:opacity-80"
    >
      #{number}
    </a>
  );
}
