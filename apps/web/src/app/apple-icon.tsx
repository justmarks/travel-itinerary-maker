import { ImageResponse } from "next/og";

/**
 * Apple Touch Icon. Generated as a 180×180 PNG at build time.
 *
 * Why this exists separately from `icon.svg`: iOS Safari doesn't
 * reliably render SVG home-screen icons — it either ignores them
 * entirely or renders only a fragment of the SVG (the white "i" stem
 * in our case, which manifests as a thin vertical line on the home
 * screen). PNG is the only format Apple's PWA install path is
 * guaranteed to handle correctly.
 *
 * Next.js auto-detects this file and emits the matching
 * `<link rel="apple-touch-icon" href="...">` tag, taking precedence
 * over any `apple` entry in `metadata.icons`.
 *
 * Design mirrors `app/icon.svg`:
 *   - dark zinc background (#18181b)
 *   - orange map-pin (#c2502e) at the top
 *   - white stem (#fafafa) at the bottom — the "i" of itinly as a pin
 *
 * No rounded corners — iOS masks the icon to its system corner radius
 * itself, so a square is the correct primitive.
 */

export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#18181b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Render the brand glyph at ~78% of the canvas so the safe
            area around it survives iOS's home-screen corner mask
            without clipping the pin head. */}
        <svg
          width="140"
          height="140"
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 32 8 C 27 8 23 12 23 17 C 23 22.5 32 30 32 30 C 32 30 41 22.5 41 17 C 41 12 37 8 32 8 Z"
            fill="#c2502e"
          />
          <circle cx="32" cy="16" r="2.6" fill="#18181b" />
          <rect x="29" y="36" width="6" height="22" rx="2" fill="#fafafa" />
        </svg>
      </div>
    ),
    size,
  );
}
