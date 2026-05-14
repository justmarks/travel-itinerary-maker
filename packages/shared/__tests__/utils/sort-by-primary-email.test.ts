import { sortByPrimaryEmail } from "../../src/utils/sort-by-primary-email";

interface Entry {
  id: string;
  email: string;
}

const e = (id: string, email: string): Entry => ({ id, email });

describe("sortByPrimaryEmail", () => {
  it("returns a copy when there's nothing to sort (empty)", () => {
    const input: Entry[] = [];
    const out = sortByPrimaryEmail(input, (x) => x.email, "user@example.com");
    expect(out).toEqual([]);
    expect(out).not.toBe(input);
  });

  it("returns a copy when there's only one item (nothing to reorder)", () => {
    const input = [e("a", "user@example.com")];
    const out = sortByPrimaryEmail(input, (x) => x.email, "user@example.com");
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("returns a copy when primaryEmail is null (no sort key)", () => {
    const input = [e("a", "alice@x.com"), e("b", "bob@x.com")];
    const out = sortByPrimaryEmail(input, (x) => x.email, null);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("moves the matching entry to the front", () => {
    const input = [
      e("a", "alice@x.com"),
      e("b", "bob@x.com"),
      e("c", "carol@x.com"),
    ];
    const out = sortByPrimaryEmail(input, (x) => x.email, "bob@x.com");
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps non-matching entries in their original relative order (stable partition)", () => {
    const input = [
      e("a", "alice@x.com"),
      e("b", "primary@x.com"),
      e("c", "carol@x.com"),
      e("d", "primary@x.com"),
      e("e", "eve@x.com"),
    ];
    const out = sortByPrimaryEmail(input, (x) => x.email, "primary@x.com");
    // Matching items first (b, d) in original order, then the non-
    // matching in original order (a, c, e).
    expect(out.map((x) => x.id)).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("case-insensitive match", () => {
    const input = [
      e("a", "user@example.com"),
      e("b", "User@Example.COM"),
      e("c", "other@x.com"),
    ];
    const out = sortByPrimaryEmail(input, (x) => x.email, "USER@example.com");
    // Both `a` and `b` match the primary email irrespective of case;
    // they keep their relative order ahead of the non-matching `c`.
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns a copy when no entries match the primary email", () => {
    const input = [e("a", "alice@x.com"), e("b", "bob@x.com")];
    const out = sortByPrimaryEmail(input, (x) => x.email, "noone@x.com");
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("doesn't mutate the input", () => {
    const input = [
      e("a", "alice@x.com"),
      e("b", "primary@x.com"),
    ];
    const snapshot = input.map((x) => ({ ...x }));
    sortByPrimaryEmail(input, (x) => x.email, "primary@x.com");
    expect(input).toEqual(snapshot);
  });
});
