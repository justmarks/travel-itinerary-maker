import { access, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// After `next build` with output: "export", Next.js generates its own
// out/404.html from not-found.tsx, overwriting anything we put in public/.
// Copy our SPA-redirect 404 into place so GitHub Pages serves the redirect
// shim for unknown paths (see scripts/404.html). Substitute __BASE_PATH__
// with the build's configured basePath so the shim works under PR-preview
// subdirectories like /travel-itinerary-maker/previews/pr-89.
//
// In non-export builds (NODE_ENV !== production in this project), `out/`
// does not exist — skip silently.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "out");

try {
  await access(outDir);
} catch {
  console.log("postbuild: out/ not present (non-export build), skipping");
  process.exit(0);
}

const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/travel-itinerary-maker" : "");

const src = join(root, "scripts", "404.html");
const dest = join(outDir, "404.html");
const template = await readFile(src, "utf8");
const rendered = template.replaceAll("__BASE_PATH__", basePath);
await writeFile(dest, rendered, "utf8");
console.log(`postbuild: wrote ${dest} (basePath=${basePath || "<empty>"})`);
