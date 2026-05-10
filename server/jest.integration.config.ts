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
  // Load `server/.env` so `DATABASE_URL` (and any future integration
  // env vars) work without prefixing every command. Jest doesn't
  // execute the server's entry point, so dotenv has to be wired in
  // explicitly here. Safe because integration tests already require
  // external state — env loading is part of that contract.
  setupFiles: ["dotenv/config"],
  // Integration tests open real DB connections; running them in
  // parallel often exhausts connection limits. Single worker keeps it
  // deterministic.
  maxWorkers: 1,
};

export default config;
