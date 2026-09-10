import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logError, logWarn } from "../server/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON lines with scope and message", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("http", "GET /api/issues 200", { status: 200, user: "u1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const rec = JSON.parse(String(spy.mock.calls[0][0])) as {
      scope: string;
      msg: string;
      status: number;
      user: string;
      level: string;
    };
    expect(rec.scope).toBe("http");
    expect(rec.msg).toContain("GET /api/issues");
    expect(rec.status).toBe(200);
    expect(rec.user).toBe("u1");
    expect(rec.level).toBe("info");
  });

  it("serializes errors without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logError("issues", "run failed", { err: new Error("boom") });
    logWarn("github", "oauth callback failed", { message: "expired" });
    const rec = JSON.parse(String(spy.mock.calls[0][0])) as {
      err: { message: string };
    };
    expect(rec.err.message).toBe("boom");
    expect(warn).toHaveBeenCalled();
  });
});
