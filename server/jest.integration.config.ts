import type { Config } from "jest";

/**
 * Integration test config — runs only `*.integration.test.ts`. These
 * tests need a live Postgres at `DATABASE_URL`. Invoked via
 * `pnpm test:integration` from the server package.
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  testMatch: ["**/__tests__/**/*.integration.test.ts"],
  // Integration tests open real DB connections; running them in
  // parallel often exhausts connection limits. Single worker keeps it
  // deterministic.
  maxWorkers: 1,
};

export default config;
