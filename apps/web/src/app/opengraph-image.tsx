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
export const alt = "itinly — auto-generated trips from email";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#18181b",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: 96,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        {/* Brand mark — same i-as-pin glyph as the favicon, rendered larger */}
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 36,
            background: "rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 56,
          }}
        >
          <svg width="120" height="120" viewBox="0 0 64 64">
            <path
              d="M 32 8 C 27 8 23 12 23 17 C 23 22.5 32 30 32 30 C 32 30 41 22.5 41 17 C 41 12 37 8 32 8 Z"
              fill="#c2502e"
            />
            <circle cx="32" cy="16" r="2.6" fill="#18181b" />
            <rect x="29" y="36" width="6" height="22" rx="2" fill="#fafafa" />
          </svg>
        </div>

        <div
          style={{
            fontSize: 144,
            fontWeight: 600,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          itinly
        </div>
        <div
          style={{
            fontSize: 36,
            marginTop: 28,
            opacity: 0.7,
          }}
        >
          Auto-generated trip plans from your email.
        </div>
      </div>
    ),
    size,
  );
}
