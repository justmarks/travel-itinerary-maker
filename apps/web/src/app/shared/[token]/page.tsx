import type { Metadata } from "next";
import { headers } from "next/headers";
import SharedPageClient from "./shared-page-client";
import { getShareSnapshot } from "@/lib/share-snapshot";

// Default Node serverless runtime. We previously set
// `runtime = "edge"` here so unfurl crawlers got a per-trip title
// fetched from Upstash with edge-distributed latency, but the bundle
// size for the Edge function exceeded Vercel Hobby's 1 MB cap (the
// route's RSC payload pulled in `@vercel/og` and the framework
// runtime). Node serverless has a 50 MB cap; the cold-start cost vs
// Edge is ~150-300 ms, which is invisible to crawlers (they cache
// the response for hours/days) and to real users (the service
// worker caches the page after the first load).
//
// The metadata logic itself (Upstash lookup + classifyUserAgent +
// `<meta>` tag emission) is unchanged. Only the runtime declaration
// changed.

// Substrings of user-agents we treat as link-preview crawlers. Used
// only to tag log lines so we can split unfurl traffic from real human
// visits in Vercel's runtime logs.
const CRAWLER_UA_PATTERNS = [
  "slackbot",
  "twitterbot",
  "facebookexternalhit",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "applebot",
  "googlebot",
  "bingbot",
];

function classifyUserAgent(ua: string | null): "crawler" | "human" | "unknown" {
  if (!ua) return "unknown";
  const lower = ua.toLowerCase();
  return CRAWLER_UA_PATTERNS.some((p) => lower.includes(p))
    ? "crawler"
    : "human";
}

function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const ua = (await headers()).get("user-agent");
  const client = classifyUserAgent(ua);
  const snapshot = await getShareSnapshot(token);
  console.log(
    JSON.stringify({
      event: "share.metadata.render",
      tokenTag: token.slice(0, 8),
      found: Boolean(snapshot),
      client,
    }),
  );
  if (!snapshot) {
    // Token unknown or Redis unavailable — fall back to the static
    // root-layout metadata. Don't index a missing share.
    return {
      title: "Shared trip",
      robots: { index: false, follow: false },
    };
  }
  const range = fmtRange(snapshot.startDate, snapshot.endDate);
  const dayLabel = snapshot.dayCount === 1 ? "day" : "days";
  const description = `${range} · ${snapshot.dayCount} ${dayLabel}`;
  return {
    title: `${snapshot.title} · Shared itinerary`,
    description,
    openGraph: {
      title: snapshot.title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: snapshot.title,
      description,
    },
    robots: { index: false, follow: false },
  };
}

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  return <SharedPageClient token={token} />;
}
