import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Only public, indexable pages. Auth-gated routes (/, /trips, /m, /m/trip)
// redirect signed-out visitors away, so listing them here would point Google
// at content it can't reach. Private share links (/shared/[token],
// /m/shared/[token]) are unlisted by design — robots.txt also disallows
// them so a leaked URL doesn't surface in search.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${SITE_URL}/welcome`,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
