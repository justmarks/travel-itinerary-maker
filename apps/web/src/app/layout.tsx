import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
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
// Reads NEXT_PUBLIC_BASE_PATH first so PR previews stay self-contained
// under their own subdirectory of the gh-pages site.
const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/travel-itinerary-maker" : "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Travel Itinerary Maker",
  description: "Auto-generate travel itineraries from email confirmations",
  // Setting `metadata.icons` as an object suppresses Next's auto-discovery
  // of `app/icon.svg`, so the regular `<link rel="icon">` tag must be
  // declared here too — otherwise browsers fall back to /favicon.ico
  // (a default gray-globe glyph on GH Pages). Both URLs include the
  // basePath because Next does NOT auto-prepend it for entries in
  // metadata.icons (the manifest has its own handling).
  icons: {
    icon: `${BASE_PATH}/icon.svg`,
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
}): React.JSX.Element {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
