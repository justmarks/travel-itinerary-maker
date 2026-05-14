import { probeMicrosoftScope } from "../../src/services/microsoft-scope-probe";

describe("probeMicrosoftScope", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 'granted' on 200 from /me/mailFolders for the email capability", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: [{ id: "inbox" }] }), { status: 200 }),
    );
    expect(await probeMicrosoftScope("at", "email")).toBe("granted");
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/me/mailFolders");
  });

  it("returns 'granted' on 200 from /me/calendars for the calendar capability", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: [{ id: "cal1" }] }), { status: 200 }),
    );
    expect(await probeMicrosoftScope("at", "calendar")).toBe("granted");
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/me/calendars");
  });

  it("returns 'denied' on a 403 from Graph (scope missing)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "ErrorAccessDenied",
            message: "Access is denied. Check credentials and try again.",
          },
        }),
        { status: 403 },
      ),
    );
    expect(await probeMicrosoftScope("at", "email")).toBe("denied");
  });

  it("returns 'unknown' on 401 (token format-rejected or expired)", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await probeMicrosoftScope("at", "email")).toBe("unknown");
  });

  it("returns 'unknown' on 5xx (transient Graph outage)", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await probeMicrosoftScope("at", "email")).toBe("unknown");
  });

  it("returns 'unknown' on network / DNS error", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    expect(await probeMicrosoftScope("at", "calendar")).toBe("unknown");
  });

  it("returns 'unknown' for an empty access token", async () => {
    expect(await probeMicrosoftScope("", "email")).toBe("unknown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the access token as a Bearer header", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
    await probeMicrosoftScope("ms-at-123", "email");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ms-at-123");
  });
});
