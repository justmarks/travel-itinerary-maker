/**
 * Reads the share-snapshot the backend persisted at share-creation time
 * out of Upstash Redis, used by `generateMetadata` on the shared-trip
 * route so unfurl previews show the actual trip title and date range
 * instead of the site's default OG description.
 *
 * Runs on the Cloudflare Pages Edge runtime, so it must avoid Node-only
 * APIs. `@upstash/redis` is HTTP-based and works there out of the box.
 *
 * The snapshot is written by `server/src/services/share-snapshot-store.ts`
 * — keep the hash name and field shape in sync with that file.
 */

import { Redis } from "@upstash/redis";

export interface ShareSnapshot {
  title: string;
  startDate: string;
  endDate: string;
  dayCount: number;
}

const REDIS_HASH = "share-snapshots";

let cachedClient: Redis | null = null;

function getClient(): Redis | null {
  if (cachedClient) return cachedClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  cachedClient = new Redis({ url, token });
  return cachedClient;
}

// Truncate so log entries are grep-able without persisting full
// capability tokens in Vercel's log retention.
function tokenTag(token: string): string {
  return token.slice(0, 8);
}

export type ShareLookupOutcome = "hit" | "miss" | "error" | "no-config";

function logLookup(
  token: string,
  outcome: ShareLookupOutcome,
  durationMs: number,
  errorMessage?: string,
): void {
  console.log(
    JSON.stringify({
      event: "share.snapshot.lookup",
      tokenTag: tokenTag(token),
      outcome,
      durationMs,
      ...(errorMessage ? { error: errorMessage } : {}),
    }),
  );
}

/**
 * Returns the snapshot for a share token, or null if the token is
 * unknown or Redis isn't configured. Never throws — failure paths
 * just degrade to the static fallback metadata in `layout.tsx`.
 */
export async function getShareSnapshot(
  token: string,
): Promise<ShareSnapshot | null> {
  const startedAt = Date.now();
  const client = getClient();
  if (!client) {
    logLookup(token, "no-config", 0);
    return null;
  }
  try {
    const value = await client.hget<ShareSnapshot>(REDIS_HASH, token);
    logLookup(token, value ? "hit" : "miss", Date.now() - startedAt);
    return value ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLookup(token, "error", Date.now() - startedAt, message);
    return null;
  }
}
