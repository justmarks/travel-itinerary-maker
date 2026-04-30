import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Used by Next to resolve relative URLs in metadata (og:image, twitter:image,
// apple-touch-icon) into absolute URLs at build time. Set
// NEXT_PUBLIC_SITE_URL to your deployed origin (e.g. the pages.dev URL or a
// custom domain). Falls back to localhost for dev so unfurl previews don't
// crash with an invalid URL.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Travel Itinerary Maker",
  description: "Auto-generate travel itineraries from email confirmations",
  // Setting `metadata.icons` as an object suppresses Next's auto-discovery
  // of `app/icon.svg`, so the regular `<link rel="icon">` tag must be
  // declared here too — otherwise browsers fall back to /favicon.ico
  // (a default gray-globe glyph).
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
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
        {/* top-center keeps toasts from overlapping the top-right header
            controls (avatar, share button, action pills) on the mobile
            trip page where vertical space is tight. */}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
