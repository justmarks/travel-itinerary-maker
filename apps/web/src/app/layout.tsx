import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Travel Itinerary Maker",
  description: "Auto-generate travel itineraries from email confirmations",
};

// Companion to public/404.html — when GitHub Pages redirects an unknown
// path to "/?/original/path", rewrite the URL back to its original form
// before React hydrates so the router matches the intended route.
// Based on https://github.com/rafgraph/spa-github-pages
const spaRedirectRecover = `(function(l){
  if (l.search && l.search[1] === '/') {
    var decoded = l.search.slice(1).split('&').map(function(s){
      return s.replace(/~and~/g, '&');
    }).join('?');
    window.history.replaceState(null, '', l.pathname.slice(0, -1) + decoded + l.hash);
  }
})(window.location);`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <Script
          id="spa-redirect-recover"
          strategy="beforeInteractive"
        >
          {spaRedirectRecover}
        </Script>
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
