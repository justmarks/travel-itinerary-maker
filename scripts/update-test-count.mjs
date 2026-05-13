#!/usr/bin/env node
/**
 * Updates the "Current coverage: **N tests** across M test suites."
 * line in README.md from a fresh `pnpm test` run.
 *
 * Run manually before opening a PR that materially changes the test
 * count, or wire into CI as a post-test step that fails the build
 * when the README is stale. Sums the per-package totals reported by
 * each Jest runner.
 *
 * Why a separate script: the count is shown in README's marketing-y
 * "Getting Started" section. Embedding it in the workflow makes the
 * number trustworthy without humans having to remember.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const COUNT_LINE_REGEX =
  /Current coverage: \*\*\d+ tests\*\* across \d+ test suites\./;

function parseTotals(output) {
  let tests = 0;
  let suites = 0;
  for (const match of output.matchAll(/Tests:\s+(\d+)\s+passed,\s+\1\s+total/g)) {
    tests += Number(match[1]);
  }
  for (const match of output.matchAll(
    /Test Suites:\s+(\d+)\s+passed,\s+\1\s+total/g,
  )) {
    suites += Number(match[1]);
  }
  return { tests, suites };
}

function main() {
  const checkOnly = process.argv.includes("--check");

  console.log("[update-test-count] running pnpm test…");
  // Capture stdout so we can parse it; pipe stderr through so the
  // user still sees progress / failure messages in the terminal.
  const output = execSync("pnpm test", {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  const { tests, suites } = parseTotals(output);
  if (tests === 0 || suites === 0) {
    console.error(
      "[update-test-count] couldn't parse Tests / Suites totals from test output.",
    );
    process.exit(2);
  }

  const readme = readFileSync("README.md", "utf-8");
  const replacement = `Current coverage: **${tests} tests** across ${suites} test suites.`;

  if (!COUNT_LINE_REGEX.test(readme)) {
    console.error(
      "[update-test-count] README is missing the coverage line. Expected: " +
        "`Current coverage: **N tests** across M test suites.`",
    );
    process.exit(2);
  }

  const next = readme.replace(COUNT_LINE_REGEX, replacement);
  if (next === readme) {
    console.log(`[update-test-count] README already up to date: ${replacement}`);
    return;
  }

  if (checkOnly) {
    console.error(
      "[update-test-count] README is STALE. Run `pnpm update-test-count` to refresh.",
    );
    console.error(`  expected: ${replacement}`);
    process.exit(1);
  }

  writeFileSync("README.md", next);
  console.log(`[update-test-count] README updated: ${replacement}`);
}

main();
