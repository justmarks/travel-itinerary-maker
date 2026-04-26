import { ImageResponse } from "next/og";

/**
 * Open Graph share card. Generated as a 1200×630 PNG at build time
 * by Next.js — this file is the page-level convention so any Slack /
 * Messages / Twitter unfurl of the deployed site shows the brand
 * mark + tagline instead of a generic screenshot.
 *
 * Edit:
 *  - Brand colour and tagline live below.
 *  - Image regenerates on the next build.
 */

// Required for static export — Next pre-renders the image at build
// time and emits a real PNG file in `out/`.
export const dynamic = "force-static";
export const alt = "Travel Itinerary Maker — auto-generated trips from email";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#4f46e5",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: 96,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        {/* Logo — same paper-plane mark as the favicon, rendered larger */}
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 36,
            background: "rgba(255, 255, 255, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 56,
          }}
        >
          <svg width="120" height="120" viewBox="0 0 64 64">
            <path
              d="M48 16 L14 30 L26 34 L30 48 L34 38 L48 16 Z M26 34 L34 38"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: -1,
            lineHeight: 1.05,
          }}
        >
          Travel Itinerary Maker
        </div>
        <div
          style={{
            fontSize: 36,
            marginTop: 28,
            opacity: 0.85,
          }}
        >
          Auto-generated trip plans from your email.
        </div>
      </div>
    ),
    size,
  );
}
