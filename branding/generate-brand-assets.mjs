// Regenerate every PNG asset in branding/ and apps/web/public/ from
// the canonical SVG sources for the locked palette-A brand system.
//
// Run from the repo root:  node branding/generate-brand-assets.mjs
//
// Assets emitted:
//   branding/itinly-icon-{16,32,48,64,128,192,256,512,1024}.png
//   branding/itinly-header-logo.png            (1× — 320×80)
//   branding/itinly-header-logo@1x.png         (alias for 1×)
//   branding/itinly-header-logo@2x.png         (640×160)
//   apps/web/public/itinly-wordmark.png        (256×80, 1×)
//   apps/web/public/itinly-wordmark@2x.png     (512×160, 2×)
//
// All SVGs match the components in apps/web/src/ and apps/web/src/app/,
// so editing the brand glyph means: update the SVG strings here AND
// the matching component (or vice versa).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BRANDING_DIR = resolve(REPO_ROOT, "branding");
const PUBLIC_DIR = resolve(REPO_ROOT, "apps/web/public");

// ─── Source SVGs ────────────────────────────────────────────────────

// Square brand icon — Direction 16, palette A. Mirrors
// apps/web/src/app/icon.svg.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1A2B3C"/>
  <path d="M 5 31 L 11 28 L 17 30 L 23 27 L 30 30 L 37 28 L 43 31 L 50 28 L 57 30 L 60 36 L 58 42 L 60 49 L 57 55 L 50 57 L 43 55 L 37 58 L 30 55 L 23 58 L 17 55 L 10 57 L 5 53 L 4 47 L 5 41 L 4 36 Z" fill="#F8F9FA"/>
  <ellipse cx="18" cy="38" rx="3" ry="1.5" fill="#1A2B3C" opacity="0.07"/>
  <ellipse cx="50" cy="50" rx="2.5" ry="1.3" fill="#1A2B3C" opacity="0.06"/>
  <path d="M 8 42 Q 14 38 20 41 Q 26 44 32 40 Q 38 36 44 41 Q 50 44 56 40" stroke="#1A2B3C" stroke-width="0.7" fill="none" opacity="0.45"/>
  <path d="M 12 50 Q 20 47 26 49 Q 34 52 40 46 Q 44 42 46 40" stroke="#1A2B3C" stroke-width="0.9" fill="none" stroke-dasharray="0.6 2" stroke-linecap="round" opacity="0.65"/>
  <path d="M 46 34 C 43 34 41 36 41 39 C 41 43 46 50 46 50 C 46 50 51 43 51 39 C 51 36 49 34 46 34 Z" fill="#D9501C"/>
  <circle cx="46" cy="38.5" r="1.5" fill="#F8F9FA"/>
  <path d="M 10 14 Q 26 8 42 30" stroke="#008CCF" stroke-width="1.4" fill="none" stroke-dasharray="2.5 2" stroke-linecap="round"/>
  <g transform="translate(10 14) rotate(125) scale(0.55)">
    <path d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z" fill="#D9501C"/>
  </g>
</svg>`;

// Wordmark only — "ıtınly" with the 9C flight motif (origin dot →
// cyan dashed contrail → orange plane silhouette as the second i's
// tittle). 200×80 viewBox so the trail has air above the letterforms.
function wordmarkSVG({ textColor = "#1A2B3C" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
  <text x="0" y="58" font-family="Inter, system-ui, sans-serif" font-size="48" font-weight="500" fill="${textColor}" letter-spacing="-1">&#x131;t&#x131;nly</text>
  <circle cx="8" cy="22" r="3" fill="#D9501C"/>
  <path d="M 11 20 Q 22 2 32 14" stroke="#008CCF" stroke-width="1.2" fill="none" stroke-dasharray="2.5 1.8" stroke-linecap="round"/>
  <g transform="translate(34 16) rotate(130) scale(0.55)">
    <path d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z" fill="#D9501C"/>
  </g>
</svg>`;
}

// Header lockup — square icon on the left, wordmark on the right,
// horizontally aligned. Used as the website / login-page brand
// header. 320×80 base, doubled for @2x.
function headerLogoSVG({ textColor = "#1A2B3C" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80">
  <g transform="translate(8 8) scale(1)">
    <rect width="64" height="64" rx="14" fill="#1A2B3C"/>
    <path d="M 5 31 L 11 28 L 17 30 L 23 27 L 30 30 L 37 28 L 43 31 L 50 28 L 57 30 L 60 36 L 58 42 L 60 49 L 57 55 L 50 57 L 43 55 L 37 58 L 30 55 L 23 58 L 17 55 L 10 57 L 5 53 L 4 47 L 5 41 L 4 36 Z" fill="#F8F9FA"/>
    <ellipse cx="18" cy="38" rx="3" ry="1.5" fill="#1A2B3C" opacity="0.07"/>
    <ellipse cx="50" cy="50" rx="2.5" ry="1.3" fill="#1A2B3C" opacity="0.06"/>
    <path d="M 8 42 Q 14 38 20 41 Q 26 44 32 40 Q 38 36 44 41 Q 50 44 56 40" stroke="#1A2B3C" stroke-width="0.7" fill="none" opacity="0.45"/>
    <path d="M 12 50 Q 20 47 26 49 Q 34 52 40 46 Q 44 42 46 40" stroke="#1A2B3C" stroke-width="0.9" fill="none" stroke-dasharray="0.6 2" stroke-linecap="round" opacity="0.65"/>
    <path d="M 46 34 C 43 34 41 36 41 39 C 41 43 46 50 46 50 C 46 50 51 43 51 39 C 51 36 49 34 46 34 Z" fill="#D9501C"/>
    <circle cx="46" cy="38.5" r="1.5" fill="#F8F9FA"/>
    <path d="M 10 14 Q 26 8 42 30" stroke="#008CCF" stroke-width="1.4" fill="none" stroke-dasharray="2.5 2" stroke-linecap="round"/>
    <g transform="translate(10 14) rotate(125) scale(0.55)">
      <path d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z" fill="#D9501C"/>
    </g>
  </g>
  <g transform="translate(92 0)">
    <text x="0" y="58" font-family="Inter, system-ui, sans-serif" font-size="48" font-weight="500" fill="${textColor}" letter-spacing="-1">&#x131;t&#x131;nly</text>
    <circle cx="8" cy="22" r="3" fill="#D9501C"/>
    <path d="M 11 20 Q 22 2 32 14" stroke="#008CCF" stroke-width="1.2" fill="none" stroke-dasharray="2.5 1.8" stroke-linecap="round"/>
    <g transform="translate(34 16) rotate(130) scale(0.55)">
      <path d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z" fill="#D9501C"/>
    </g>
  </g>
</svg>`;
}

// ─── Helpers ────────────────────────────────────────────────────────

function renderToPNG(svg, { width, height }) {
  const fitTo = height
    ? { mode: "height", value: height }
    : { mode: "width", value: width };
  const resvg = new Resvg(svg, {
    fitTo,
    background: "rgba(0, 0, 0, 0)",
    font: {
      // Inter's `latin-ext` subset (which includes ı, U+0131) is loaded
      // by next/font in the live app, but Resvg can't reach the web
      // font, so the `font-family="Inter, system-ui, ..."` fallback
      // chain falls through to whichever sans-serif is on the
      // generating machine. The dotless-i renders on every modern
      // system font, so the fallback is acceptable.
      loadSystemFonts: true,
    },
  });
  return resvg.render().asPng();
}

function writePNG(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  console.log(`  wrote ${path} (${buffer.length} bytes)`);
}

// ─── Generate ───────────────────────────────────────────────────────

console.log("Square icon set (branding/itinly-icon-*.png):");
const ICON_SIZES = [16, 32, 48, 64, 128, 192, 256, 512, 1024];
for (const size of ICON_SIZES) {
  writePNG(
    resolve(BRANDING_DIR, `itinly-icon-${size}.png`),
    renderToPNG(ICON_SVG, { width: size }),
  );
}

console.log("\nHeader lockup (branding/itinly-header-logo*.png):");
const headerSvg = headerLogoSVG();
const header1x = renderToPNG(headerSvg, { width: 320 });
const header2x = renderToPNG(headerSvg, { width: 640 });
writePNG(resolve(BRANDING_DIR, "itinly-header-logo.png"), header1x);
writePNG(resolve(BRANDING_DIR, "itinly-header-logo@1x.png"), header1x);
writePNG(resolve(BRANDING_DIR, "itinly-header-logo@2x.png"), header2x);

console.log("\nIn-app wordmark (apps/web/public/itinly-wordmark*.png):");
const wordmarkSvg = wordmarkSVG();
writePNG(
  resolve(PUBLIC_DIR, "itinly-wordmark.png"),
  renderToPNG(wordmarkSvg, { width: 256 }),
);
writePNG(
  resolve(PUBLIC_DIR, "itinly-wordmark@2x.png"),
  renderToPNG(wordmarkSvg, { width: 512 }),
);

console.log("\nDone.");
