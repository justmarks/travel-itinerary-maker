import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  // Restrict to *.test.ts so non-test helpers (e.g. contract suites
  // shared across backends in `__tests__/storage/contract.ts`) aren't
  // picked up as suites just because they live under __tests__.
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Default `pnpm test` skips integration tests — those need a live
  // Postgres and are gated behind `pnpm test:integration`.
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
};

export default config;
