/**
 * Sanity checks on `createApp`'s option validation. The end-to-end
 * correctness of `SupabaseStorage` (read/write trips, settings,
 * share rules, processed_emails) is proven by the contract suite in
 * `supabase-storage.integration.test.ts` — this file just verifies
 * the wiring layer rejects misconfigurations with a useful error
 * rather than a confusing crash later.
 *
 * Lives in the integration suite (not unit) only because `createApp`
 * is async and the unit-config skip pattern excludes
 * `*.integration.test.ts`.
 */
import { createApp } from "../../src/app";

describe("createApp option validation", () => {
  it("rejects mode=postgres without a dbClient", async () => {
    await expect(createApp({ mode: "postgres" })).rejects.toThrow(
      /dbClient is required/,
    );
  });

  it("rejects mode=memory without a storage instance", async () => {
    await expect(createApp({ mode: "memory" })).rejects.toThrow(
      /InMemoryStorage instance required/,
    );
  });
});
