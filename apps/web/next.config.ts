import type { NextConfig } from "next";
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
  // Surfaced in the UserMenu dropdown. Sourced from this package's version so
  // the version-bump workflow keeps it in sync with the rest of the project.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
