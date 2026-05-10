/**
 * Latency baseline harness — captures p50/p95 for the top routes against
 * `InMemoryStorage` so future phases (Postgres, Supabase) can be compared
 * against a stable floor.
 *
 *     cd server && pnpm bench:routes              # check vs committed baseline
 *     cd server && pnpm bench:routes -- --update  # rewrite the baseline
 *
 * The baseline file lives at `docs/perf-baselines.json` at the repo root.
 * Numbers are intentionally floor-y (in-memory storage, single Node
 * process, supertest's fresh-connection-per-request overhead included).
 * The point isn't absolute numbers — it's a *fair* harness applied
 * identically across phases so we can spot regressions when storage
 * implementations change.
 *
 * Not wired into PR CI yet — shared runners are too noisy for tight
 * budgets. Will move into a nightly job once the harness is stable and
 * we have a Postgres-backed baseline to compare against.
 */
import fs from "fs";
import path from "path";
import request from "supertest";
import type express from "express";
import { createApp } from "../src/app";
import { InMemoryStorage } from "../src/services/storage";

const BASELINES_PATH = path.resolve(
  __dirname,
  "../../docs/perf-baselines.json",
);
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS ?? "50", 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP ?? "5", 10);
// 1.5 = a measured route can be 50% slower than baseline before failing.
// Loose because shared CI runners are noisy; tighten when we move to a
// dedicated nightly runner.
const REGRESSION_RATIO = parseFloat(
  process.env.BENCH_REGRESSION_RATIO ?? "1.5",
);

interface Sample {
  route: string;
  p50ms: number;
  p95ms: number;
}

interface Scenario {
  /** Label used as the key in the baselines JSON. Keep stable across runs. */
  name: string;
  /** Optional per-iteration setup; result is passed to `run`. */
  setup?: (app: express.Express) => Promise<unknown>;
  /** The measured operation. */
  run: (app: express.Express, ctx: unknown) => Promise<unknown>;
}

// Each setup needs a unique date range — the trips API rejects overlap.
// Each iteration claims a 7-day block far in the future to avoid
// collisions across scenarios and warmup/measurement phases.
const BLOCK_DAYS = 7;
let blockCounter = 0;
function nextTripBlock(): { startDate: string; endDate: string } {
  const idx = blockCounter++;
  const start = idx * BLOCK_DAYS;
  return {
    startDate: dateAtOffset(start),
    endDate: dateAtOffset(start + 2),
  };
}
function dateAtOffset(offset: number): string {
  const base = new Date("2036-01-01T00:00:00Z").getTime();
  const d = new Date(base + offset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor((p / 100) * sortedAsc.length),
  );
  return sortedAsc[idx];
}

async function bench(
  app: express.Express,
  scenario: Scenario,
): Promise<Sample> {
  // Warmup — let V8 JIT settle and any first-hit caches warm.
  for (let i = 0; i < WARMUP; i++) {
    const ctx = scenario.setup ? await scenario.setup(app) : null;
    await scenario.run(app, ctx);
  }

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const ctx = scenario.setup ? await scenario.setup(app) : null;
    const start = performance.now();
    await scenario.run(app, ctx);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    route: scenario.name,
    p50ms: percentile(samples, 50),
    p95ms: percentile(samples, 95),
  };
}

const SCENARIOS: Scenario[] = [
  {
    name: "POST /api/v1/trips",
    setup: async () => nextTripBlock(),
    run: async (app, ctx) => {
      const { startDate, endDate } = ctx as {
        startDate: string;
        endDate: string;
      };
      await request(app)
        .post("/api/v1/trips")
        .send({ title: "Bench trip", startDate, endDate })
        .expect(201);
    },
  },
  {
    name: "GET /api/v1/trips",
    run: async (app) => {
      await request(app).get("/api/v1/trips").expect(200);
    },
  },
  {
    name: "GET /api/v1/trips/:tripId",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId } = ctx as { tripId: string };
      await request(app).get(`/api/v1/trips/${tripId}`).expect(200);
    },
  },
  {
    name: "PUT /api/v1/trips/:tripId",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId, startDate, endDate } = ctx as TripCtx;
      await request(app)
        .put(`/api/v1/trips/${tripId}`)
        .send({ title: "Updated", startDate, endDate })
        .expect(200);
    },
  },
  {
    name: "GET /api/v1/trips/:tripId/days",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId } = ctx as TripCtx;
      await request(app).get(`/api/v1/trips/${tripId}/days`).expect(200);
    },
  },
  {
    name: "POST /api/v1/trips/:tripId/segments",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId, startDate } = ctx as TripCtx;
      await request(app)
        .post(`/api/v1/trips/${tripId}/segments`)
        .send({
          date: startDate,
          type: "flight",
          title: "Bench flight",
          startTime: "09:00",
        })
        .expect(201);
    },
  },
  {
    name: "PUT /api/v1/trips/:tripId/segments/:segmentId",
    setup: async (app) => seedTripWithSegment(app),
    run: async (app, ctx) => {
      const { tripId, segmentId } = ctx as TripCtx & { segmentId: string };
      await request(app)
        .put(`/api/v1/trips/${tripId}/segments/${segmentId}`)
        .send({ title: "Updated flight" })
        .expect(200);
    },
  },
  {
    name: "DELETE /api/v1/trips/:tripId/segments/:segmentId",
    setup: async (app) => seedTripWithSegment(app),
    run: async (app, ctx) => {
      const { tripId, segmentId } = ctx as TripCtx & { segmentId: string };
      await request(app)
        .delete(`/api/v1/trips/${tripId}/segments/${segmentId}`)
        .expect(204);
    },
  },
  {
    name: "GET /api/v1/trips/:tripId/costs",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId } = ctx as TripCtx;
      await request(app).get(`/api/v1/trips/${tripId}/costs`).expect(200);
    },
  },
  {
    name: "DELETE /api/v1/trips/:tripId",
    setup: async (app) => seedTrip(app),
    run: async (app, ctx) => {
      const { tripId } = ctx as TripCtx;
      await request(app).delete(`/api/v1/trips/${tripId}`).expect(204);
    },
  },
];

interface TripCtx {
  tripId: string;
  startDate: string;
  endDate: string;
}

async function seedTrip(app: express.Express): Promise<TripCtx> {
  const { startDate, endDate } = nextTripBlock();
  const r = await request(app)
    .post("/api/v1/trips")
    .send({ title: "Bench seed", startDate, endDate });
  return { tripId: r.body.id as string, startDate, endDate };
}

async function seedTripWithSegment(
  app: express.Express,
): Promise<TripCtx & { segmentId: string }> {
  const ctx = await seedTrip(app);
  const seg = await request(app)
    .post(`/api/v1/trips/${ctx.tripId}/segments`)
    .send({
      date: ctx.startDate,
      type: "flight",
      title: "Seed flight",
      startTime: "09:00",
    });
  return { ...ctx, segmentId: seg.body.id as string };
}

interface BaselinesFile {
  capturedAt: string;
  iterations: number;
  storageBackend: string;
  nodeVersion: string;
  notes: string;
  routes: Record<string, { p50ms: number; p95ms: number }>;
}

async function main() {
  const update = process.argv.includes("--update");

  const storage = new InMemoryStorage();
  const app = await createApp({ mode: "memory", storage, disableRedis: true });

  console.log(
    `Running ${SCENARIOS.length} scenarios × ${ITERATIONS} iterations (warmup ${WARMUP})...\n`,
  );

  const samples: Sample[] = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.name} ... `);
    const sample = await bench(app, scenario);
    samples.push(sample);
    process.stdout.write(
      `p50 ${sample.p50ms.toFixed(2)}ms · p95 ${sample.p95ms.toFixed(2)}ms\n`,
    );
  }

  if (update) {
    const file: BaselinesFile = {
      capturedAt: new Date().toISOString(),
      iterations: ITERATIONS,
      storageBackend: "InMemoryStorage",
      nodeVersion: process.version,
      notes:
        "Captured during phase 0 of the Drive→Supabase migration. " +
        "InMemoryStorage floor: not directly comparable to Postgres-backed " +
        "numbers; the harness is what's identical across phases. Re-run " +
        "with `pnpm bench:routes -- --update` after intentional perf changes.",
      routes: Object.fromEntries(
        samples.map((s) => [s.route, { p50ms: s.p50ms, p95ms: s.p95ms }]),
      ),
    };
    fs.writeFileSync(BASELINES_PATH, JSON.stringify(file, null, 2) + "\n");
    console.log(`\n✓ Wrote ${BASELINES_PATH}`);
    return;
  }

  // Check mode
  if (!fs.existsSync(BASELINES_PATH)) {
    console.error(
      `\nNo baselines at ${BASELINES_PATH}. Run with --update to capture.`,
    );
    process.exit(1);
  }
  const existing = JSON.parse(
    fs.readFileSync(BASELINES_PATH, "utf8"),
  ) as BaselinesFile;

  let regressions = 0;
  let unknown = 0;
  console.log("\nResults vs baseline:");
  for (const sample of samples) {
    const baseline = existing.routes[sample.route];
    if (!baseline) {
      unknown++;
      console.log(
        `  [NEW]    ${sample.route}: p95 ${sample.p95ms.toFixed(2)}ms`,
      );
      continue;
    }
    const ratio = sample.p95ms / Math.max(baseline.p95ms, 0.001);
    const status = ratio > REGRESSION_RATIO ? "REGRESS" : "OK";
    if (ratio > REGRESSION_RATIO) regressions++;
    console.log(
      `  [${status.padEnd(7)}] ${sample.route}: p95 ${sample.p95ms.toFixed(2)}ms ` +
        `(baseline ${baseline.p95ms.toFixed(2)}ms, ratio ${ratio.toFixed(2)}×)`,
    );
  }

  console.log(
    `\n${samples.length} scenarios · ${regressions} regression(s) · ${unknown} new`,
  );
  if (regressions > 0) {
    console.error(
      `\n✗ ${regressions} route(s) regressed beyond ${REGRESSION_RATIO}× threshold.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
