import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Used by Next to resolve relative URLs in metadata (og:image, twitter:image,
// apple-touch-icon) into absolute URLs at build time. Origin only — Next
// prepends `basePath` automatically for og:image and the manifest, so
// don't include the path here. Override locally with NEXT_PUBLIC_SITE_URL
// when testing against a different origin.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://justmarks.github.io";

// Mirrors the basePath set in next.config.ts. Needed for metadata fields
// where Next does NOT auto-prepend basePath (notably icons.apple).
const BASE_PATH =
  process.env.NODE_ENV === "production" ? "/travel-itinerary-maker" : "";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Travel Itinerary Maker",
  description: "Auto-generate travel itineraries from email confirmations",
  // Next picks up `icon.svg` and `opengraph-image.tsx` automatically.
  // Apple-touch-icon needs an explicit hint — point it at the same SVG
  // so iOS devices that honour SVG home-screen icons get the brand
  // mark. Older iOS may fall back to the regular favicon. The path
  // includes the basePath because Next does NOT auto-prepend it for
  // metadata.icons entries (manifest has its own handling).
  icons: {
    apple: `${BASE_PATH}/icon.svg`,
  },
  openGraph: {
    title: "Travel Itinerary Maker",
    description: "Auto-generate travel itineraries from email confirmations.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Travel Itinerary Maker",
    description: "Auto-generate travel itineraries from email confirmations.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
