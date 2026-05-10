/**
 * Sanity checks on `createApp`'s phase 1 option validation. The
 * end-to-end correctness of `SupabaseStorage` (read/write trips,
 * settings, share rules, processed_emails) is proven by the contract
 * suite in `supabase-storage.integration.test.ts` — this file just
 * verifies the wiring layer rejects misconfigurations with a useful
 * error rather than a confusing crash later.
 *
 * Lives in the integration suite (not unit) only because `createApp`
 * is async and the unit-config skip pattern excludes
 * `*.integration.test.ts`.
 */
import { createApp } from "../../src/app";

describe("createApp — phase 1 option validation", () => {
  it("rejects mode=postgres without a dbClient", async () => {
    await expect(createApp({ mode: "postgres" })).rejects.toThrow(
      /dbClient is required/,
    );
  });

  it("rejects mode=drive with a non-empty postgresUserIds but no dbClient", async () => {
    await expect(
      createApp({
        mode: "drive",
        postgresUserIds: new Set(["dogfood-user"]),
        disableRedis: true,
      }),
    ).rejects.toThrow(/dbClient is required/);
  });

  it("rejects mode=drive with empty postgresUserIds and no dbClient (still ok)", async () => {
    // Drive mode without any Postgres users should still build cleanly
    // — the dbClient is unused, so it doesn't need to be provided.
    // This is the existing production path, ensuring phase 1's wiring
    // doesn't regress it.
    await expect(
      createApp({ mode: "drive", disableRedis: true }),
    ).resolves.toBeDefined();
  });

  it("rejects mode=memory without a storage instance", async () => {
    await expect(createApp({ mode: "memory" })).rejects.toThrow(
      /InMemoryStorage instance required/,
    );
  });
});
