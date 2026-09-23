import { describe, expect, it } from "vitest";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  agentUsageFromSdk,
  formatAgentUsage,
  formatAgentUsageDetail,
  formatTokenCount,
  parseAgentUsageJson,
} from "../shared/agentUsage.js";

describe("agent usage helpers", () => {
  it("maps SDK getUsage() payloads and ignores empty snapshots", () => {
    expect(agentUsageFromSdk(null)).toBeNull();
    expect(agentUsageFromSdk({ usage: undefined })).toBeNull();
    const usage = agentUsageFromSdk({
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        totalTokens: 1640,
        reasoningTokens: 12,
      },
      cost: { rawCostCents: 18, chargedCents: 9 },
    });
    expect(usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 80,
      totalTokens: 1640,
      chargedCents: 9,
    });
    expect(usage?.updatedAt).toBeGreaterThan(0);
  });

  it("parses persisted JSON and formats compact labels", () => {
    expect(parseAgentUsageJson("not-json")).toBeUndefined();
    expect(
      parseAgentUsageJson({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    ).toBeUndefined();
    const parsed = parseAgentUsageJson(
      JSON.stringify({
        inputTokens: 12_400,
        outputTokens: 2100,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        totalTokens: 14_900,
        rawCostCents: 42,
        chargedCents: 42,
      }),
    );
    expect(parsed?.totalTokens).toBe(14_900);
    expect(formatTokenCount(980)).toBe("980");
    expect(formatTokenCount(14900)).toBe("15k");
    expect(formatAgentUsage(parsed!)).toBe("15k tok · $0.42");
    expect(formatAgentUsageDetail(parsed!)).toContain("in 12k");
    expect(formatAgentUsageDetail(parsed!)).toContain("$0.42");
  });
});

const usageDbDir = join(tmpdir(), `steer-usage-${randomUUID()}`);
mkdirSync(usageDbDir, { recursive: true });
process.env.SQLITE_PATH = join(usageDbDir, "test.db");

describe("agent usage persistence", () => {
  it("stores and reloads usage_json on an agent", async () => {
    const db = await import("../server/db/index.js");
    const room = db.createRoom({
      id: randomUUID(),
      name: "Usage room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
    });
    const agent = db.createAgent({ roomId: room.id, label: "Cursor" });
    expect(parseAgentUsageJson(agent.usage_json)).toBeUndefined();

    const usage = agentUsageFromSdk({
      usage: {
        inputTokens: 500,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 550,
      },
    });
    db.setAgentUsage(agent.id, usage);
    const reloaded = db.getAgent(agent.id);
    const parsed = parseAgentUsageJson(reloaded?.usage_json);
    expect(parsed?.totalTokens).toBe(550);
    expect(parsed?.inputTokens).toBe(500);
  });
});
