import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /auth/callback is an OAuth landing — dynamic, no useful content.
      // /shared/* and /m/shared/* are private share links; a leaked token
      // shouldn't surface in search results.
      disallow: ["/auth/", "/shared/", "/m/shared/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
