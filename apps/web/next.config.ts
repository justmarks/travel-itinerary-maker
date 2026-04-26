import type { NextConfig } from "next";
import path from "path";
import pkg from "./package.json";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Static export only in production (GitHub Pages). In dev mode, use the
  // normal Next.js server so dynamic route params work for real trips.
  ...(isProd ? { output: "export" as const } : {}),
  basePath: isProd ? "/travel-itinerary-maker" : "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@travel-app/shared", "@travel-app/api-client"],
  // Prevent Next.js from walking up to a parent lockfile (e.g. a global
  // package-lock.json in the user's home directory) and picking the wrong
  // workspace root. Explicitly anchor it to the monorepo root.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Surfaced in the UserMenu dropdown. Sourced from this package's version so
  // the version-bump workflow keeps it in sync with the rest of the project.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
