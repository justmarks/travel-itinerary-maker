import type { NextConfig } from "next";
import path from "path";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Cloudflare Pages serves the site at the project's root (or a custom
  // domain), so we no longer need GitHub Pages' `/travel-itinerary-maker`
  // basePath nor the static-export pipeline. The Edge runtime in
  // `app/shared/[token]/page.tsx` requires SSR.
  images: {
    // Keep unoptimised: we deploy to CF Pages and don't run Next's
    // optimiser server. Trip card hero images come from Wikipedia and
    // Unsplash and don't need transforming.
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
