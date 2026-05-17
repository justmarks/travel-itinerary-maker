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
                v1.2.0 — Scheduled scans, share target, cruises on the timeline
              </h2>
              <p className="text-sm text-muted-foreground">May 16, 2026</p>
            </header>

            <p>
              Schedule a scan once and let itinly check your inbox on its own.
              Send a confirmation straight from any iOS or Android share sheet
              without going through Gmail at all. Cruises and car rentals get
              their own multi-day bands on the timeline. The segment add / edit
              form trims down to its essentials, and a long list of
              accessibility, parity, and parsing fixes round out the release.
            </p>

            <Subsection title="Auto email-scan scheduler">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Recurring scans</strong> on a daily or weekly cadence
                  — pick a folder or label per provider, anchor on a specific
                  time of day (and day-of-week, for weekly), and itinly polls
                  the mailbox on its own.
                </li>
                <li>
                  <strong>Multiple schedules per user</strong> — one per
                  (provider × folder × cadence) tuple, so a personal Gmail{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Travel/
                  </code>{" "}
                  label and a work Outlook folder can run independently on
                  different rhythms.
                </li>
                <li>
                  <strong>Include sub-folders / sub-labels</strong> — a single
                  &ldquo;Travel&rdquo; pick optionally fans out to every
                  descendant (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Travel/Hotels
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    Travel/Flights/Confirmed
                  </code>
                  , …) so you don&apos;t have to enumerate them.
                </li>
                <li>
                  <strong>Findings land in the same review queue</strong> as a
                  manual scan — nothing is auto-applied, so a scheduled scan
                  can&apos;t silently put a misparsed booking on a real trip.
                </li>
                <li>
                  <strong>Push notification + in-app banner</strong> when a
                  scheduled scan turns up something new, deep-linking straight
                  to the review step on either desktop or mobile.
                </li>
                <li>
                  <strong>Pause / resume / edit / delete</strong> each schedule
                  from{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /settings/account
                  </code>
                  , with a &ldquo;Recent runs&rdquo; history dialog (last 50
                  per schedule).
                </li>
                <li>
                  <strong>Backed by Supabase pg_cron + pg_net</strong> firing a
                  shared-secret-guarded tick endpoint; per-user row-level
                  security on the new tables.
                </li>
              </ul>
            </Subsection>

            <Subsection title="PWA polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>&ldquo;Send to itinly&rdquo; share target</strong> —
                  pick itinly from any iOS or Android share sheet and the
                  shared text / URL / page title goes straight into the
                  parser. Forwarded confirmations from non-Gmail mailboxes
                  work without leaving Mail.
                </li>
                <li>
                  <strong>&ldquo;Create trip&rdquo; app-icon shortcut</strong>{" "}
                  — long-press the installed PWA icon (Android) or right-click
                  it (desktop) to jump straight into a new-trip sheet.
                </li>
                <li>
                  <strong>App-icon badge</strong> on the installed PWA —
                  incoming push notifications bump a numeric badge on the icon
                  (Chromium / Edge / iOS 16.4+ Safari); cleared when you bring
                  the app forward or tap the notification.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Timeline + segment polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>
                    Cruises render as multi-day bands on the Lodging lane
                  </strong>{" "}
                  instead of a single-day pill under Activities — same visual
                  treatment as a hotel block, but with the ship name + 🚢 +
                  duration.
                </li>
                <li>
                  <strong>Car rentals get their own multi-day bands</strong>{" "}
                  on the Transport lane, packed onto the same row as the
                  per-day flight / train / transfer pills so the rental window
                  is visible at a glance.
                </li>
                <li>
                  <strong>Overlapping lodging bars no longer disappear</strong>{" "}
                  — hotels and cruises that overlap (e.g. a hotel on
                  embarkation day plus the cruise that picks up from there)
                  pack onto separate tracks instead of one bar silently
                  clobbering the other.
                </li>
                <li>
                  <strong>Richer car rental titles</strong> like &ldquo;Hertz -
                  Lihue&rdquo;, with pickup / dropoff cities and times in the
                  calendar event description; the all-day event spans through
                  the dropoff date inclusive.
                </li>
                <li>
                  <strong>
                    Dedicated{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      shipName
                    </code>{" "}
                    field on cruises
                  </strong>{" "}
                  — extracted automatically by the email parser, used in the
                  timeline pill and calendar event title; ports of call render
                  in the calendar description.
                </li>
                <li>
                  <strong>Cost displays always show 2 decimals</strong> (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    288.40
                  </code>{" "}
                  instead of{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    288.4
                  </code>
                  ).
                </li>
              </ul>
            </Subsection>

            <Subsection title="Cleaner segment form">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>&ldquo;More options&rdquo; disclosure</strong> at the
                  bottom of the add / edit form gathers everything past the
                  core booking fields — cabin class, baggage info, address,
                  phone, breakfast included, free-form details, plus Cost and
                  Confirmation # — into one collapsible section.
                </li>
                <li>
                  <strong>&ldquo;N filled&rdquo; hint</strong> on the
                  disclosure header so a rich parsed booking still telegraphs
                  how much sits behind the fold without auto-expanding.
                </li>
                <li>
                  <strong>Whole desktop segment cards are clickable</strong>{" "}
                  to open the edit dialog (the pencil icon stays for
                  discoverability); Enter / Space on a focused row works the
                  same.
                </li>
                <li>
                  <strong>Clearing the cost field now persists</strong> —
                  previously the empty value silently no-op&apos;d and the
                  old cost stayed put.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Email parsing">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>
                    Prefers the plain-text part on noisy multipart
                    confirmations
                  </strong>{" "}
                  when the HTML alternative is dominated by marketing copy and
                  image alt text. A Marriott Vacation Club receipt that
                  previously parsed as &ldquo;no travel content&rdquo; now
                  produces the right hotel + dates + total.
                </li>
                <li>
                  <strong>
                    No-travel-content emails no longer report to Sentry
                  </strong>{" "}
                  — promotional mail that Claude correctly skipped was creating
                  false-positive operator alerts.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Accessibility + parity pass">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Screen-reader labels on icon-only buttons</strong> —
                  trip-card rename save / cancel, trip-card overflow menu,
                  scheduled-scan row Pause / Edit / Delete, to-do panel
                  add / cancel toggle, EditableCity save / cancel, share-link
                  &ldquo;ready&rdquo; announcement.
                </li>
                <li>
                  <strong>Escape cancels EditableCity</strong> to match the
                  rest of the inline editors.
                </li>
                <li>
                  <strong>
                    Segment row actions reveal on keyboard focus
                  </strong>{" "}
                  (Edit / Confirm / Delete + the city-edit pencil) instead of
                  being hover-only.
                </li>
                <li>
                  <strong>
                    Empty days surface &ldquo;Add the first activity&rdquo;
                    CTA
                  </strong>{" "}
                  on desktop instead of a flat &ldquo;No activities
                  planned&rdquo; placeholder.
                </li>
                <li>
                  <strong>
                    Mobile to-do detail sheet renders a Markdown preview
                  </strong>{" "}
                  under the Notes textarea, matching the desktop edit-todo
                  dialog.
                </li>
                <li>
                  <strong>Dialog inputs stop clipping the focus ring</strong>{" "}
                  on the left (edit-todo, add / edit segment, html-import,
                  suggest-meals).
                </li>
                <li>
                  <strong>Schedule editor stores correct UTC during DST</strong>{" "}
                  — a 9:15 AM PDT pick now writes 16:15 UTC, not 17:15.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Trust and polish">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>
                    RLS on every{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      email_scan_*
                    </code>{" "}
                    table
                  </strong>{" "}
                  captured in migration 0004 — idempotent and guarded for
                  vanilla Postgres so CI integration tests still pass on a
                  non-Supabase container.
                </li>
                <li>
                  <strong>
                    Routine{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      [auth] supabase token not used …
                    </code>{" "}
                    log gated behind{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      DEBUG_AUTH=1
                    </code>
                  </strong>{" "}
                  so steady-state Railway logs aren&apos;t drowned by Supabase
                  JWT expiry / legacy Google access-token coexistence noise.
                </li>
                <li>
                  <strong>Trip-card rename input auto-focuses</strong> when it
                  appears.
                </li>
                <li>
                  <strong>
                    Stale service workers unregister in dev mode
                  </strong>{" "}
                  so a cached{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /m
                  </code>{" "}
                  shell from a prior session doesn&apos;t masquerade as the
                  live build.
                </li>
                <li>
                  <strong>Mobile / desktop parity</strong> in costs editing
                  and share-link error surfacing.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Under the hood">
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <strong>Drizzle migrations 0003 – 0006</strong> land the
                  schedules + runs tables, RLS policies, the{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    include_sublabels
                  </code>{" "}
                  flag, and the time-of-day / day-of-week anchor columns.
                </li>
                <li>
                  <strong>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      ts-node
                    </code>{" "}
                    is now an explicit devDependency
                  </strong>{" "}
                  on{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    server
                  </code>{" "}
                  so a fresh install doesn&apos;t fail the migration runner.
                </li>
                <li>
                  <strong>
                    Shared{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      expandLabelFilters
                    </code>{" "}
                    helper
                  </strong>{" "}
                  keeps the manual{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /emails/scan
                  </code>{" "}
                  route and the scheduled executor in agreement on how to
                  expand a parent label/folder into its descendants.
                </li>
                <li>
                  <strong>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                      packIntoTracks
                    </code>{" "}
                    helper
                  </strong>{" "}
                  centralises the timeline&apos;s overlap-aware lane packing
                  for hotels, cruises, and rentals.
                </li>
                <li>
                  <strong>SSRF-guarded URL fetch</strong> on the new{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[0.875em]">
                    /emails/import-shared
                  </code>{" "}
                  endpoint — http(s) only, blocks loopback / RFC1918 /
                  link-local / cloud-metadata hosts, 10s timeout, 1 MB cap,
                  content-type filter.
                </li>
                <li>
                  <strong>Tests grew from 948 → 967</strong> — new server
                  coverage for schedules CRUD, the cron tick, share-target
                  routes, plain-text-preference parsing, and the cost-clear
                  contract.
                </li>
              </ul>
            </Subsection>

            <Subsection title="Thanks">
              <p>
                Schedule one scan; never look at a confirmation email again.
                Onward to 1.2.x.
              </p>
            </Subsection>
          </section>

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
