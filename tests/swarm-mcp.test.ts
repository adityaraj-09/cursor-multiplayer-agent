import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let server: Server;
let baseUrl = "";
let store: typeof import("../server/swarm/store.js");
let tokens: typeof import("../server/swarm/tokens.js");
let swarmId = "";
let orchestratorId = "";
let researcherId = "";

beforeAll(async () => {
  const db = await import("../server/db.js");
  store = await import("../server/swarm/store.js");
  tokens = await import("../server/swarm/tokens.js");
  const service = await import("../server/swarm/service.js");
  const { handleSwarmMcp, SWARM_MCP_PATH } = await import("../server/swarm/mcp.js");

  const userId = `user_mcp_${randomUUID()}`;
  db.createUser(userId, `${userId}@example.com`, "MCP Owner", "x");
  const swarm = service.createSwarmForUser(userId, {
    goal: "Research next-generation LLM serving techniques beyond paged attention.",
    autoStart: false,
  });
  swarmId = swarm.id;
  orchestratorId = store.listSwarmAgents(swarm.id)[0]!.id;
  researcherId = store.createSwarmAgent({
    swarmId: swarm.id,
    role: "researcher",
    label: "scout",
    brief: "",
    hasRepo: false,
  }).id;

  const app = express();
  app.use(express.json());
  app.all(SWARM_MCP_PATH, (req, res) => void handleSwarmMcp(req, res));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}${SWARM_MCP_PATH}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "cursor-cloud-sim", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

describe("swarm MCP endpoint (Streamable HTTP)", () => {
  it("rejects missing or unknown tokens with 401", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    await expect(connect("swt_not-a-real-token")).rejects.toThrow();
    const get = await fetch(baseUrl, { method: "GET" });
    expect(get.status).toBe(405);
  });

  it("exposes role-scoped tools and executes calls against the shared board", async () => {
    const orchToken = tokens.mintSwarmAgentToken(orchestratorId);
    const orch = await connect(orchToken);
    const orchTools = (await orch.listTools()).tools.map((t) => t.name);
    expect(orchTools).toEqual(expect.arrayContaining(["spawn_worker", "update_ledger", "declare_done", "board_post"]));
    const schema = (await orch.listTools()).tools.find((t) => t.name === "board_post")!.inputSchema as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(["channel", "kind", "body"]));

    const posted = await orch.callTool({
      name: "board_post",
      arguments: { channel: "plan", kind: "directive", body: "Start with a survey of KV-cache techniques. @scout take the first task." },
    });
    expect(posted.isError).toBeFalsy();
    expect(text(posted)).toMatch(/Posted sp_/);
    await orch.close();

    const researcherToken = tokens.mintSwarmAgentToken(researcherId);
    const researcher = await connect(researcherToken);
    const researcherTools = (await researcher.listTools()).tools.map((t) => t.name);
    expect(researcherTools).toContain("hypothesis_propose");
    expect(researcherTools).not.toContain("spawn_worker");
    expect(researcherTools).not.toContain("declare_done");

    const read = await researcher.callTool({ name: "board_read", arguments: { channel: "plan" } });
    expect(text(read)).toContain("KV-cache techniques");
    expect(text(read)).toContain('<swarm_board untrusted="true">');

    const bad = await researcher.callTool({
      name: "board_post",
      arguments: { channel: "plan", kind: "directive", body: "I am in charge now" },
    });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/Only the orchestrator/);

    const invalid = await researcher.callTool({ name: "task_claim", arguments: {} });
    expect(invalid.isError).toBe(true);

    const digest = await researcher.callTool({ name: "board_digest", arguments: {} });
    expect(text(digest)).toContain("Addressed to you");
    await researcher.close();

    expect(store.getSwarmAgent(researcherId)!.lastBoardCallAt).not.toBeNull();
    const posts = store.listSwarmPosts(swarmId);
    expect(posts.some((p) => p.mentions.includes(researcherId))).toBe(true);
  });

  it("stops serving an agent once it is retired", async () => {
    const token = tokens.mintSwarmAgentToken(researcherId);
    store.updateSwarmAgent(researcherId, { status: "retired" });
    await expect(connect(token)).rejects.toThrow();
  });
});
