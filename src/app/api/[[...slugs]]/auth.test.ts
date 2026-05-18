import { describe, it, expect, vi, beforeEach } from "vitest";

const hgetMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  redis: {
    hget: (...args: unknown[]) => hgetMock(...args),
  },
}));

import { Elysia } from "elysia";
import { authMiddleware } from "./auth";

const app = new Elysia()
  .use(authMiddleware)
  .get("/whoami", ({ auth }) => ({ roomId: auth.roomId, token: auth.token }));

function call(opts: { roomId?: string; token?: string }) {
  const url = `http://localhost/whoami${opts.roomId ? `?roomId=${opts.roomId}` : ""}`;
  const headers: Record<string, string> = {};
  if (opts.token) headers["cookie"] = `x-auth-token=${opts.token}`;
  return app.handle(new Request(url, { headers }));
}

describe("authMiddleware", () => {
  beforeEach(() => {
    hgetMock.mockReset();
  });

  it("rejects requests with no token cookie", async () => {
    const res = await call({ roomId: "room1" });
    expect(res.status).toBe(401);
  });

  it("rejects requests with no roomId query", async () => {
    const res = await call({ token: "tok1" });
    expect(res.status).toBe(401);
  });

  it("rejects when token is not in the room's connected list", async () => {
    hgetMock.mockResolvedValueOnce(["other-tok"]);
    const res = await call({ roomId: "room1", token: "tok1" });
    expect(res.status).toBe(401);
  });

  it("rejects when the room hash is missing", async () => {
    hgetMock.mockResolvedValueOnce(null);
    const res = await call({ roomId: "room1", token: "tok1" });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token+room and exposes auth context", async () => {
    hgetMock.mockResolvedValueOnce(["tok1", "tok2"]);
    const res = await call({ roomId: "room1", token: "tok1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roomId: "room1", token: "tok1" });
  });
});
