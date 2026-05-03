import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  FolderLock,
  Inbox,
  Plane,
  ScanLine,
  ShieldCheck,
  Share2,
  Sparkles,
} from "lucide-react";
import { AppLogo } from "@/components/app-logo";

export const metadata: Metadata = {
  title: "itinly — your travel emails, finally an itinerary",
  description:
    "itinly scans your Gmail for flight, hotel, and reservation confirmations and builds a clean day-by-day itinerary, stored in your own Google Drive.",
};

// "Try it free" CTAs point at /login; the login page handles the
// already-signed-in case (it redirects to /). Linking directly to / would
// loop signed-out visitors right back here via RequireAuth.
const SIGN_IN_URL = "/login";

export default function WelcomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <PrivacyCallout />
        <BottomCta />
      </main>
      <Footer />
    </div>
  );
}

function Header(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-8">
        <Link href="/welcome" className="flex items-center" aria-label="itinly home">
          {/*
            Static brand wordmark — Next/Image with unoptimized: true would
            emit a plain <img> anyway (no transforms), so we use <img> with
            srcSet for retina and skip the runtime overhead. Source PNG is
            256×80 (palette-A 9C wordmark — origin dot, dashed contrail,
            plane silhouette as the second i's tittle). Width attribute
            matches the source aspect so the browser doesn't squish it
            into the smaller box that the previous stacked lockup needed.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/itinly-wordmark.png"
            srcSet="/itinly-wordmark.png 1x, /itinly-wordmark@2x.png 2x"
            alt="itinly"
            width={160}
            height={50}
            className="h-12 w-auto"
          />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
        </nav>
        <a
          href={SIGN_IN_URL}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Try it free
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}

function Hero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* Soft brand-orange wash behind the headline (palette A, hue ~40
          to match --brand). Kept extremely subtle so it doesn't compete
          with content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-[oklch(0.96_0.06_40)] via-background to-background"
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="lg:col-span-7">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3 text-[var(--brand)]" />
            For complicated international family trips
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Your travel emails,
            <br />
            <span className="text-[var(--brand)]">finally an itinerary.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Sign in with Google. itinly scans your inbox for flight, hotel, and
            reservation confirmations, parses them into structured trip data,
            and builds a clean day-by-day itinerary you can share — all stored
            in your own Google Drive.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={SIGN_IN_URL}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Try it free
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#how"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-5 py-3 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No credit card. Sign in with your Google account.
          </p>
        </div>

        <div className="lg:col-span-5">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function HeroPreview(): React.JSX.Element {
  return (
    <div className="relative">
      {/* Brand wash behind the preview card — orange (--brand, hue ~40)
          fading into cyan (--action, hue 230). Captures both palette-A
          accents in one decorative blur. */}
      <div
        aria-hidden
        className="absolute -inset-x-6 -inset-y-6 -z-10 rounded-3xl bg-gradient-to-br from-[oklch(0.96_0.07_40)] to-[oklch(0.96_0.05_230)] blur-2xl"
      />
      <div className="rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-[var(--brand)]/10 p-1.5">
              <Plane className="h-3.5 w-3.5 text-[var(--brand)]" />
            </div>
            <p className="text-sm font-semibold tracking-tight">
              Tokyo &amp; Kyoto, Spring &apos;26
            </p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Day 3 of 9
          </span>
        </div>
        <div className="space-y-2">
          <SegmentRow
            time="07:40"
            title="Flight NRT → ITM"
            subtitle="ANA 037 · Seat 14A"
          />
          <SegmentRow
            time="10:25"
            title="Train Itami → Kyoto"
            subtitle="Haruka express"
          />
          <SegmentRow
            time="13:00"
            title="Check-in: The Thousand Kyoto"
            subtitle="Reservation #CONF-7742"
            highlight
          />
          <SegmentRow
            time="19:30"
            title="Dinner: Gion Karyo"
            subtitle="Party of 4 · kaiseki"
          />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FolderLock className="h-3.5 w-3.5" />
            Saved to your Google Drive
          </span>
          <span>4 segments</span>
        </div>
      </div>
      <div className="absolute -left-4 top-6 hidden rotate-[-4deg] sm:block">
        <EmailChip subject="Your Delta itinerary — NRT" sender="Delta" />
      </div>
      <div className="absolute -right-2 bottom-10 hidden rotate-[3deg] sm:block">
        <EmailChip subject="Booking confirmed: Thousand Kyoto" sender="Hotels" />
      </div>
    </div>
  );
}

function SegmentRow({
  time,
  title,
  subtitle,
  highlight = false,
}: {
  time: string;
  title: string;
  subtitle: string;
  highlight?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
        highlight
          ? "border-[var(--brand)]/30 bg-[var(--brand)]/5"
          : "border-border bg-background"
      }`}
    >
      <div className="w-12 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {time}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function EmailChip({
  subject,
  sender,
}: {
  subject: string;
  sender: string;
}): React.JSX.Element {
  return (
    <div className="max-w-[200px] rounded-lg border border-border bg-background p-2.5 shadow-lg">
      <div className="flex items-center gap-1.5">
        <Inbox className="h-3 w-3 text-muted-foreground" />
        <p className="truncate text-[10px] font-medium text-muted-foreground">
          {sender}
        </p>
      </div>
      <p className="mt-1 truncate text-xs font-medium">{subject}</p>
    </div>
  );
}

function HowItWorks(): React.JSX.Element {
  const steps = [
    {
      n: "01",
      title: "Sign in with Google",
      body:
        "One click. itinly only requests the scopes it needs to read travel emails, write to a single Drive folder, and (optionally) sync your calendar.",
    },
    {
      n: "02",
      title: "Run a scan",
      body:
        "itinly searches your inbox for flight, hotel, train, and reservation confirmations, then sends just those messages to Claude for parsing.",
    },
    {
      n: "03",
      title: "Get your itinerary",
      body:
        "Trips appear as a clean day-by-day timeline. Edit segments, add to-dos, share with the family, and push to Google Calendar in one tap.",
    },
  ];
  return (
    <section
      id="how"
      className="border-b border-border/60 bg-background py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wider text-[var(--brand)]">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            From scattered confirmations to a real plan, in three steps.
          </h2>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li
              key={s.n}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <div className="font-mono text-sm text-muted-foreground">
                {s.n}
              </div>
              <h3 className="mt-3 text-lg font-semibold tracking-tight">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features(): React.JSX.Element {
  const features = [
    {
      icon: ScanLine,
      title: "AI email parsing",
      body:
        "Claude reads PDFs, HTML, and plain-text confirmations from any airline, hotel chain, or booking site — not a brittle list of templates.",
    },
    {
      icon: FolderLock,
      title: "Your Drive, your data",
      body:
        "Every trip is a JSON file in a single folder in your Google Drive. Cancel itinly anytime; your itineraries stay where you can read them.",
    },
    {
      icon: CalendarDays,
      title: "Calendar sync",
      body:
        "Push every segment to Google Calendar with the right time zone — your phone shows the right times wherever you land.",
    },
    {
      icon: Share2,
      title: "Share without sign-up",
      body:
        "Send a private link to anyone — co-travelers, parents, the dog-sitter. Recipients see the trip without creating an account.",
    },
    {
      icon: Inbox,
      title: "Manual import too",
      body:
        "Don't use Gmail? Paste an email's HTML or upload an XLSX export. itinly parses it the same way.",
    },
    {
      icon: Plane,
      title: "Built for real trips",
      body:
        "Multi-leg flights, layovers, train transfers, and reservations across countries — designed for the messy international itineraries that other planners can't handle.",
    },
  ];
  return (
    <section id="features" className="border-b border-border/60 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wider text-[var(--brand)]">
            What you get
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Designed for the trips other planners give up on.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 transition hover:border-foreground/20"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrivacyCallout(): React.JSX.Element {
  return (
    <section className="border-b border-border/60 py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-4 sm:px-8">
        <div className="rounded-3xl border border-border bg-card p-8 sm:p-12">
          <div className="flex items-start gap-4">
            <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                We don&apos;t copy your data.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Trip data lives in a single folder in your own Google Drive. We
                hold an encrypted refresh token so share links keep working
                while you&apos;re offline — that&apos;s the only piece of you
                on our servers. No tracking pixels, no ad partners, no resale
                of your data, ever.
              </p>
              <Link
                href="/privacy"
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-[var(--brand)]"
              >
                Read the full privacy policy
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BottomCta(): React.JSX.Element {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Stop copy-pasting flight times.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Sign in with Google and let itinly build the trip for you.
        </p>
        <a
          href={SIGN_IN_URL}
          className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3.5 text-base font-medium text-primary-foreground transition hover:opacity-90"
        >
          Try it free
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2">
          <AppLogo className="h-6 w-6" />
          <span className="text-sm font-semibold">itinly</span>
          <span className="text-xs text-muted-foreground">© 2026</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a
            href="mailto:support@itinly.app"
            className="hover:text-foreground"
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
