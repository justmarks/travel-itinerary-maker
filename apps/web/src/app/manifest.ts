import type { MetadataRoute } from "next";

/**
 * Web app manifest. Lets the site be added to a phone's home screen
 * with the brand icon (i-as-pin on zinc square) instead of a generic
 * screenshot.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "itinly",
    short_name: "itinly",
    description:
      "Auto-generate travel itineraries from email confirmations.",
    // Land installed users in the mobile shell — that's the experience
    // tuned for phone use. The auto-redirect from `/` would also work but
    // adds a flicker on every cold launch.
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#18181b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
