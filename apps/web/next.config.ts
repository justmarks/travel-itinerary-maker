import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/travel-itinerary-maker" : "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@travel-app/shared", "@travel-app/api-client"],
};

export default nextConfig;
