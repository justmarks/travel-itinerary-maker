// Regenerate apps/web/src/app/favicon.ico from the same design as icon.svg.
// Run: node apps/web/scripts/generate-favicon.mjs
//
// The favicon.ico bundles three rasterized PNGs (16×16, 32×32, 48×48)
// — Google Search needs >= 48 px and most browsers prefer the 32 px
// entry, while 16 px is still requested by older clients.
//
// The icon design is the locked palette-A treasure map: layered
// strokes + curves + dashed lines that are too fiddly for hand-rolled
// ray tracing, so we delegate to @resvg/resvg-js (a Rust SVG renderer)
// to rasterize the canonical SVG at each size.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(__dirname, "../src/app/icon.svg");
const OUT = resolve(__dirname, "../src/app/favicon.ico");

const svg = readFileSync(SVG_PATH, "utf8");

function renderPNG(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  });
  return resvg.render().asPng();
}

function packICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = Buffer.alloc(16 * entries.length);
  const datas = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    // ICO directory uses 0 to mean "256" for sizes >= 256.
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
    datas.push(e.data);
  });
  return Buffer.concat([header, dir, ...datas]);
}

const sizes = [16, 32, 48];
const entries = sizes.map((size) => ({ size, data: renderPNG(size) }));
const ico = packICO(entries);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ico);
console.log(`Wrote ${OUT} (${ico.length} bytes, sizes: ${sizes.join("/")})`);
