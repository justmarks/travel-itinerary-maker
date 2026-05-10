/**
 * Drizzle client factory. Phase 0 ships the wiring; phase 1 starts
 * using it from `SupabaseStorage`.
 *
 * Use `createDbClient()` once per process and pass the resulting
 * `db` around — node-postgres `Pool` is thread-safe and connection
 * pooling matters far more than per-request client creation.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface DbClient {
  db: Db;
  pool: Pool;
  /** Closes the underlying pool. Call on graceful shutdown. */
  close: () => Promise<void>;
}

export function createDbClient(
  connectionString: string,
  poolConfig: Omit<PoolConfig, "connectionString"> = {},
): DbClient {
  const pool = new Pool({ connectionString, ...poolConfig });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
