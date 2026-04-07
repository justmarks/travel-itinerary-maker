import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@travel-app/shared", "@travel-app/api-client"],
};

export default nextConfig;
