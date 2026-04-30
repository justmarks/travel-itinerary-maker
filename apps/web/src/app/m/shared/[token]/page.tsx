import type { Metadata } from "next";
import SharedTripClient from "./shared-trip-client";
import { getShareSnapshot } from "@/lib/share-snapshot";

// Edge runtime so unfurl crawlers hitting the mobile share URL get a
// per-trip preview from Upstash, just like the desktop route.
export const runtime = "edge";

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
  const snapshot = await getShareSnapshot(token);
  if (!snapshot) {
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

export default async function MobileSharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  return <SharedTripClient token={token} />;
}
