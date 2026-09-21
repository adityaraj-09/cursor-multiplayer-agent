import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logError, logWarn } from "../server/logger.js";
import { redactRequestPath } from "../server/requestLog.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes readable lines with scope and message", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("http", "GET /api/issues 200  3ms", { user: "u1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("INFO");
    expect(line).toContain("http");
    expect(line).toContain("GET /api/issues 200  3ms");
    expect(line).toContain("user=u1");
    expect(line.startsWith("{")).toBe(false);
  });

  it("serializes errors without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logError("issues", "run failed", { err: new Error("boom") });
    logWarn("github", "oauth callback failed", { message: "expired" });
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("ERROR");
    expect(line).toContain("run failed");
    expect(line).toContain("boom");
    expect(warn).toHaveBeenCalled();
  });

  it("redacts webhook secrets in request paths", () => {
    expect(
      redactRequestPath(
        "/api/voice-approvals/call-status?secret=supersecret",
      ),
    ).toBe("/api/voice-approvals/call-status?secret=***");
  });
});
