import { buildCorsOriginCheck } from "../../src/middleware/cors-origin";

function check(
  literals: string[],
  pattern: RegExp | null,
  origin: string | undefined,
): { allowed: boolean; err: Error | null } {
  let result: { allowed: boolean; err: Error | null } = {
    allowed: false,
    err: null,
  };
  buildCorsOriginCheck(literals, pattern)(origin, (err, allow) => {
    result = { allowed: !!allow, err };
  });
  return result;
}

describe("buildCorsOriginCheck", () => {
  it("allows requests with no Origin header (server-to-server)", () => {
    const { allowed } = check(["http://localhost:3000"], null, undefined);
    expect(allowed).toBe(true);
  });

  it("allows an origin in the literal list", () => {
    const { allowed } = check(
      ["http://localhost:3000", "https://project-yhbyn.vercel.app"],
      null,
      "https://project-yhbyn.vercel.app",
    );
    expect(allowed).toBe(true);
  });

  it("allows an origin matching the pattern", () => {
    const { allowed } = check(
      [],
      /^https:\/\/itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app$/,
      "https://itinly-7a3lt52rq-justmarks-projects.vercel.app",
    );
    expect(allowed).toBe(true);
  });

  it("allows a branch-alias preview URL (hyphens in the dynamic segment)", () => {
    const { allowed } = check(
      [],
      /^https:\/\/itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app$/,
      "https://itinly-git-feat-dark-mode-justmarks-projects.vercel.app",
    );
    expect(allowed).toBe(true);
  });

  it("rejects an origin missing from both literal list and pattern", () => {
    const { allowed, err } = check(
      ["http://localhost:3000"],
      /^https:\/\/example\.com$/,
      "https://malicious.example",
    );
    expect(allowed).toBe(false);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("https://malicious.example");
  });

  it("rejects everything except no-origin when literals empty and no pattern", () => {
    expect(check([], null, undefined).allowed).toBe(true);
    expect(check([], null, "http://localhost:3000").allowed).toBe(false);
  });

  it("uses literal allowlist even when a pattern is also configured", () => {
    const { allowed } = check(
      ["http://localhost:3000"],
      /^https:\/\/.*\.vercel\.app$/,
      "http://localhost:3000",
    );
    expect(allowed).toBe(true);
  });
});
