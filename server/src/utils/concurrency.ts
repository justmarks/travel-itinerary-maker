/**
 * Run `fn` over `items` with at most `concurrency` calls in flight at
 * once, preserving result order. Used by Drive-heavy code paths
 * (listTrips, fan-out backfill, cascade-revoke) so a user with N trips
 * doesn't pay N × ~300ms of sequential round-trips.
 *
 * Concurrency is bounded (rather than `Promise.all` unbounded) because
 * Google Drive starts rate-limiting at high parallelism — a 6-wide
 * worker pool stays comfortably under the per-user quota (~1000 req
 * per 100s) even when chained writes follow the reads. If a worker
 * throws, every other in-flight worker drains then the aggregated
 * promise rejects with the first error — no half-done writes left
 * pending.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) throw new Error("concurrency must be >= 1");
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown = null;

  async function worker(): Promise<void> {
    while (firstError === null) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
  return results;
}
