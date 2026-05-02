// Regenerate apps/web/src/app/favicon.ico from the same design as icon.svg.
// Run: node apps/web/scripts/generate-favicon.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/app/favicon.ico");

const BG = [0x18, 0x18, 0x1b, 0xff];
const PIN = [0xc2, 0x50, 0x2e, 0xff];
const DOT = [0x18, 0x18, 0x1b, 0xff];
const I_BAR = [0xfa, 0xfa, 0xfa, 0xff];
const TRANSPARENT = [0, 0, 0, 0];

function buildPinPolygon(steps = 32) {
  const segments = [
    [[32, 8], [27, 8], [23, 12], [23, 17]],
    [[23, 17], [23, 22.5], [32, 30], [32, 30]],
    [[32, 30], [32, 30], [41, 22.5], [41, 17]],
    [[41, 17], [41, 12], [37, 8], [32, 8]],
  ];
  const pts = [];
  for (const [p0, p1, p2, p3] of segments) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      pts.push([x, y]);
    }
  }
  return pts;
}

const PIN_POLY = buildPinPolygon();

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInRoundedRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const left = x < x0 + r;
  const right = x > x0 + w - r;
  const top = y < y0 + r;
  const bottom = y > y0 + h - r;
  let cx, cy;
  if (left && top) { cx = x0 + r; cy = y0 + r; }
  else if (right && top) { cx = x0 + w - r; cy = y0 + r; }
  else if (left && bottom) { cx = x0 + r; cy = y0 + h - r; }
  else if (right && bottom) { cx = x0 + w - r; cy = y0 + h - r; }
  else return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function pointInCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function pointInRect(x, y, x0, y0, w, h) {
  return x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
}

function renderAt(size) {
  const sub = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const u = (px + (sx + 0.5) / sub) / size;
          const v = (py + (sy + 0.5) / sub) / size;
          const x = u * 64;
          const y = v * 64;
          let color = TRANSPARENT;
          if (pointInRoundedRect(x, y, 0, 0, 64, 64, 14)) color = BG;
          if (pointInPolygon(x, y, PIN_POLY)) color = PIN;
          if (pointInCircle(x, y, 32, 16, 2.6)) color = DOT;
          if (pointInRect(x, y, 29, 36, 6, 22)) color = I_BAR;
          r += color[0]; g += color[1]; b += color[2]; a += color[3];
        }
      }
      const n = sub * sub;
      const idx = (py * size + px) * 4;
      pixels[idx] = Math.round(r / n);
      pixels[idx + 1] = Math.round(g / n);
      pixels[idx + 2] = Math.round(b / n);
      pixels[idx + 3] = Math.round(a / n);
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
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
    dir.writeUInt8(e.size === 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size === 256 ? 0 : e.size, o + 1);
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
const entries = sizes.map((size) => ({ size, data: encodePNG(renderAt(size), size, size) }));
const ico = packICO(entries);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ico);
console.log(`Wrote ${OUT} (${ico.length} bytes, sizes: ${sizes.join("/")})`);
