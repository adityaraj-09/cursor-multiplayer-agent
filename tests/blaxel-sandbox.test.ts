import { describe, expect, it } from "vitest";
import {
  isBlaxelConfigured,
  isValidBlaxelName,
  sandboxExternalId,
  sandboxNameFor,
  shellQuote,
} from "../server/sandbox/blaxel.js";

describe("Blaxel sandbox helpers", () => {
  it("requires both BL_API_KEY and BL_WORKSPACE", () => {
    const prevKey = process.env.BL_API_KEY;
    const prevWs = process.env.BL_WORKSPACE;
    delete process.env.BL_API_KEY;
    delete process.env.BL_WORKSPACE;
    expect(isBlaxelConfigured()).toBe(false);
    process.env.BL_API_KEY = "bl_test";
    expect(isBlaxelConfigured()).toBe(false);
    process.env.BL_WORKSPACE = "steer";
    expect(isBlaxelConfigured()).toBe(true);
    if (prevKey === undefined) delete process.env.BL_API_KEY;
    else process.env.BL_API_KEY = prevKey;
    if (prevWs === undefined) delete process.env.BL_WORKSPACE;
    else process.env.BL_WORKSPACE = prevWs;
  });

  it("builds a DNS-1123 sandbox name from room + agent ids", () => {
    const name = sandboxNameFor("AbC_12", "agent-99");
    expect(isValidBlaxelName(name)).toBe(true);
    expect(name.startsWith("s-")).toBe(true);
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(sandboxNameFor("room", "agent")).toBe("s-room-agent");
  });

  it("rejects invalid names and keeps external ids stable", () => {
    expect(isValidBlaxelName("")).toBe(false);
    expect(isValidBlaxelName("-bad")).toBe(false);
    expect(isValidBlaxelName("Good_Name")).toBe(false);
    expect(sandboxExternalId("r1", "a1")).toBe("steer-r1-a1");
    expect(sandboxExternalId("room_1", "ag:ent")).toBe("steer-room-1-ag-ent");
    expect(sandboxExternalId("r1", "a1")).toMatch(/^[a-zA-Z0-9-]+$/);
  });

  it("shell-quotes unsafe process arguments", () => {
    expect(shellQuote("safe-file.ts")).toBe("safe-file.ts");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});
