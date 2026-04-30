import type { MetadataRoute } from "next";

/**
 * Web app manifest. Lets the site be added to a phone's home screen
 * with the brand icon (paper plane) instead of a generic screenshot.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Travel Itinerary Maker",
    short_name: "Itinerary",
    description:
      "Auto-generate travel itineraries from email confirmations.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
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
