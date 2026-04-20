import type { Request, Response, NextFunction } from "express";

const mockUserinfoGet = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
      })),
    },
    oauth2: jest.fn().mockReturnValue({
      userinfo: {
        get: mockUserinfoGet,
      },
    }),
  },
}));

import { requireAuth } from "../../src/middleware/auth";

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

describe("requireAuth middleware", () => {
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  it("rejects request with no Authorization header", async () => {
    const req = makeReq();
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects Authorization header that is not Bearer scheme", async () => {
    const req = makeReq({ authorization: "Basic dXNlcjpwYXNz" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches user info and calls next for a valid token", async () => {
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "user-123", email: "test@example.com" },
    });
    const req = makeReq({ authorization: "Bearer valid-token" }) as Request & {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
    };
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("user-123");
    expect(req.userEmail).toBe("test@example.com");
    expect(req.accessToken).toBe("valid-token");
  });

  it("strips 'Bearer ' prefix before storing access token", async () => {
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u1", email: "u1@example.com" },
    });
    const req = makeReq({ authorization: "Bearer my-token-xyz" }) as Request & {
      accessToken?: string;
    };
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect(req.accessToken).toBe("my-token-xyz");
  });

  it("returns 401 when Google token validation throws", async () => {
    mockUserinfoGet.mockRejectedValueOnce(new Error("Invalid Credentials"));
    const req = makeReq({ authorization: "Bearer bad-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 error message for expired token", async () => {
    mockUserinfoGet.mockRejectedValueOnce(new Error("Token has been expired or revoked"));
    const req = makeReq({ authorization: "Bearer expired-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.json as jest.Mock).mock.calls[0][0]).toHaveProperty("error");
    expect(next).not.toHaveBeenCalled();
  });
});
