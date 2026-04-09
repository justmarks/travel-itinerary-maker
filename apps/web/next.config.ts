import type { NextConfig } from "next";

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
};

export default nextConfig;
