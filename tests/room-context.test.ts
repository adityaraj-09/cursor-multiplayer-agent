import { describe, expect, it, beforeAll } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import {
  BASELINE_BUDGET_CHARS,
  CONTEXT_BUDGET_CHARS,
  classifyIntent,
  redactSecrets,
  sanitizeMemoryText,
  tokenizeQuery,
} from "../shared/roomContext.js";
import { scanRepository } from "../server/repoContext/scan.js";
import {
  packRoomContext,
  prependPackedContext,
  scoreNode,
} from "../server/repoContext/pack.js";
import { buildAgentBriefing, toMemoryInfo } from "../server/repoContext/briefing.js";
import type { MemoryEntryInfo, RepoMapGraph } from "../shared/roomContext.js";

function gitRepoWithFiles(
  files: Record<string, string>,
): string {
  const root = mkdtempSync(join(tmpdir(), "steer-map-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test"], {
    cwd: root,
    stdio: "ignore",
  });
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
  return root;
}

describe("shared memory sanitizers and intent", () => {
  it("redacts secrets and control characters", () => {
    const dirty =
      "use sk-abcdefghijklmnopqrstuvwxyz0123 and \u0007hidden ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const cleaned = sanitizeMemoryText(dirty, 400);
    expect(cleaned).not.toMatch(/sk-/);
    expect(cleaned).not.toMatch(/ghp_/);
    expect(cleaned).not.toContain("\u0007");
    expect(redactSecrets("Bearer abcdefghijklmnopqrstuvwxyz012345")).toContain(
      "[redacted]",
    );
  });

  it("classifies debug vs feature intent", () => {
    expect(classifyIntent("GET /api/rooms 404")).toBe("debug");
    expect(classifyIntent("implement shared memory panel")).toBe("feature");
    expect(tokenizeQuery("please fix the RoomManager briefing")).toContain(
      "roommanager",
    );
  });
});

describe("repo map scan + ranking", () => {
  it("extracts TS symbols and import edges, skipping junk dirs", () => {
    const root = gitRepoWithFiles({
      "server/roomManager.ts": `
export function runAgent(prompt: string) {
  return prompt;
}
import { packRoomContext } from "./repoContext/pack.js";
`,
      "server/repoContext/pack.ts": `
export function packRoomContext() { return ""; }
`,
      "node_modules/ignore-me.ts": `export const nope = 1;`,
      "web/app/room/[id]/page.tsx": `
export default function RoomPage() { return null; }
`,
    });
    const scanned = scanRepository(root);
    expect(scanned.fileCount).toBeGreaterThanOrEqual(3);
    expect(scanned.graph.nodes.some((n) => n.path.includes("node_modules"))).toBe(
      false,
    );
    expect(
      scanned.graph.nodes.some(
        (n) => n.kind === "symbol" && n.name === "runAgent",
      ),
    ).toBe(true);
    expect(scanned.gitSha).toBeTruthy();
    const runAgent = scanned.graph.nodes.find((n) => n.name === "runAgent");
    expect(
      scoreNode(runAgent!, ["runagent", "briefing"], "fix runAgent briefing"),
    ).toBeGreaterThan(0);
  });

  it("packs a baseline tree under the budget and ranks task packs", () => {
    const graph: RepoMapGraph = {
      nodes: [
        {
          id: "server/index.ts",
          kind: "file",
          path: "server/index.ts",
          ext: ".ts",
          keywords: ["index", "rooms"],
        },
        {
          id: "server/index.ts::createRoom",
          kind: "symbol",
          path: "server/index.ts",
          name: "createRoom",
          symbolType: "use_case",
          keywords: ["create", "room"],
          exported: true,
          lineStart: 1,
          lineEnd: 4,
        },
        {
          id: "README.md",
          kind: "file",
          path: "README.md",
          ext: ".md",
          keywords: ["readme"],
        },
      ],
      edges: [
        {
          from: "server/index.ts",
          to: "server/index.ts::createRoom",
          rel: "contains",
        },
      ],
    };
    const entries: MemoryEntryInfo[] = [
      {
        id: "mem_goal",
        roomId: "r1",
        kind: "goal",
        title: "Ship shared memory",
        content: "Agents should reuse accepted room facts.",
        status: "active",
        pinned: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "mem_secret",
        roomId: "r1",
        kind: "discovery",
        title: "Ignored proposal",
        content: "should not appear",
        status: "proposed",
        pinned: false,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const baseline = packRoomContext({
      graph,
      map: {
        id: "map1",
        roomId: "r1",
        repoKey: "k",
        gitSha: "abc123",
        status: "ready",
        fileCount: 2,
        symbolCount: 1,
        edgeCount: 1,
        generatedAt: 1,
      },
      entries,
      memoryVersion: 4,
      prompt: "hello",
      isBaseline: true,
    });
    expect(baseline.isBaseline).toBe(true);
    expect(baseline.estimatedChars).toBeLessThanOrEqual(BASELINE_BUDGET_CHARS + 80);
    expect(baseline.text).toContain("<steer_repo_map");
    expect(baseline.text).toContain("<steer_shared_memory");
    expect(baseline.text).toContain("Ship shared memory");
    expect(baseline.text).not.toContain("should not appear");
    expect(baseline.entryIds).toEqual(["mem_goal"]);

    const task = packRoomContext({
      graph,
      map: {
        id: "map1",
        roomId: "r1",
        repoKey: "k",
        gitSha: "abc123",
        status: "ready",
        fileCount: 2,
        symbolCount: 1,
        edgeCount: 1,
        generatedAt: 1,
      },
      entries,
      memoryVersion: 4,
      prompt: "implement createRoom API",
      isBaseline: false,
    });
    expect(task.text.length).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS + 80);
    expect(task.text).toMatch(/createRoom|server\/index\.ts/);
    expect(task.text).not.toContain("other agent chat transcript");
  });

  it("prepends briefing without dropping the user prompt or image text field", () => {
    const packed = packRoomContext({
      graph: { nodes: [], edges: [] },
      map: null,
      entries: [],
      memoryVersion: 0,
      prompt: "fix the login button",
      isBaseline: true,
    });
    const combined = prependPackedContext("fix the login button", packed);
    expect(combined.endsWith("fix the login button")).toBe(true);
    expect(combined).toContain("<steer_repo_map");
    const imagePrompt = { text: "describe this", images: [{ url: "x" }] };
    expect({
      ...imagePrompt,
      text: prependPackedContext(imagePrompt.text, packed),
    }.images).toEqual([{ url: "x" }]);
  });
});

describe("memory persistence and agent briefing", () => {
  let db: typeof import("../server/db.js");

  beforeAll(async () => {
    db = await import("../server/db.js");
  });

  it("stores revisions, bumps version on accept, and isolates agent chat from packs", () => {
    const stamp = Date.now();
    const ownerId = `user_ctx_${stamp}`;
    db.createUser(ownerId, `${ownerId}@example.com`, "Owner", "x");
    const room = db.createRoom({
      id: `room_ctx_${stamp}`,
      name: "Context",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId,
    });
    const agentA = db.createAgent({
      roomId: room.id,
      label: "Cursor",
      createdBy: ownerId,
    });
    const agentB = db.createAgent({
      roomId: room.id,
      label: "Claude",
      createdBy: ownerId,
    });

    db.insertMessage({
      id: `msg_a_${stamp}`,
      roomId: room.id,
      role: "assistant",
      content: "SECRET_CHAT_FROM_A should never leak",
      status: "done",
      ts: Date.now(),
      agentId: agentA.id,
    });

    const proposed = db.createMemoryEntry({
      roomId: room.id,
      kind: "handoff",
      title: "WIP handoff",
      content: "Agent A thinks the API lives in server/index.ts",
      status: "proposed",
      createdByAgentId: agentA.id,
      createdByUserId: ownerId,
    });
    expect(db.getRoomMemoryVersion(room.id)).toBe(0);

    expect(() =>
      db.updateMemoryEntry({
        id: proposed.id,
        expectedRevision: 99,
        content: "stale",
      }),
    ).toThrow(/revision conflict/i);

    const accepted = db.updateMemoryEntry({
      id: proposed.id,
      expectedRevision: 1,
      status: "active",
      actorUserId: ownerId,
    });
    expect(accepted?.status).toBe("active");
    expect(accepted?.current_revision).toBe(2);
    expect(db.getRoomMemoryVersion(room.id)).toBe(1);

    const goal = db.createMemoryEntry({
      roomId: room.id,
      kind: "goal",
      title: "Keep SQLite and Postgres equivalent",
      content: "Shared memory APIs must match across adapters.",
      status: "active",
      pinned: true,
      createdByUserId: ownerId,
    });
    expect(db.getRoomMemoryVersion(room.id)).toBe(2);

    const packed = packRoomContext({
      graph: { nodes: [], edges: [] },
      map: null,
      entries: db.listMemoryEntries(room.id).map(toMemoryInfo),
      memoryVersion: db.getRoomMemoryVersion(room.id),
      prompt: "continue the API work",
      isBaseline: true,
    });
    expect(packed.text).toContain("Keep SQLite and Postgres equivalent");
    expect(packed.text).toContain("WIP handoff");
    expect(packed.text).not.toContain("SECRET_CHAT_FROM_A");
    expect(packed.entryIds).toContain(goal.id);
    expect(packed.entryIds).toContain(proposed.id);

    const otherRoom = db.createRoom({
      id: `room_other_${stamp}`,
      name: "Other",
      repoPath: "/tmp/other",
      agentCommand: "agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId,
    });
    expect(db.listMemoryEntries(otherRoom.id)).toHaveLength(0);

    const fresh = db.createAgent({
      roomId: room.id,
      label: "New agent",
      createdBy: ownerId,
    });
    const briefing = buildAgentBriefing({
      room: db.getRoom(room.id)!,
      agent: db.getAgent(fresh.id)!,
      prompt: "implement the remaining API",
    });
    expect(briefing.isBaseline).toBe(true);
    expect(briefing.text).toContain("<steer_repo_map");
    expect(briefing.text).toContain("<steer_shared_memory");
    expect(briefing.text).toContain("WIP handoff");
    expect(briefing.text).not.toContain("SECRET_CHAT_FROM_A");
    const receipts = db.listAgentContextReceipts(fresh.id, 1);
    expect(receipts[0]?.is_baseline).toBe(1);
    expect(receipts[0]?.memory_version).toBe(2);
    void agentB;
  });

  it("lets two rooms scan overlapping file paths without unique-id collisions", () => {
    const stamp = Date.now();
    const ownerId = `user_map_${stamp}`;
    db.createUser(ownerId, `${ownerId}@example.com`, "Owner", "x");
    const graph = {
      nodes: [
        {
          id: "README.md",
          kind: "file" as const,
          path: "README.md",
          ext: ".md",
          keywords: ["readme"],
        },
        {
          id: "src/app.ts",
          kind: "file" as const,
          path: "src/app.ts",
          ext: ".ts",
          keywords: ["app"],
        },
        {
          id: "src/app.ts::main",
          kind: "symbol" as const,
          path: "src/app.ts",
          name: "main",
          symbolType: "use_case",
          keywords: ["main"],
          exported: true,
        },
        {
          id: "README.md",
          kind: "file" as const,
          path: "README.md",
          ext: ".md",
          keywords: ["dup"],
        },
      ],
      edges: [
        { from: "src/app.ts", to: "src/app.ts::main", rel: "contains" as const },
      ],
    };
    const roomA = db.createRoom({
      id: `room_map_a_${stamp}`,
      name: "Map A",
      repoPath: "/tmp/a",
      agentCommand: "agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId,
    });
    const roomB = db.createRoom({
      id: `room_map_b_${stamp}`,
      name: "Map B",
      repoPath: "/tmp/b",
      agentCommand: "agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId,
    });
    const savedA = db.saveRepoMap({
      roomId: roomA.id,
      repoKey: "https://github.com/adityaraj-09/flowTape",
      gitSha: "aaa",
      status: "ready",
      fileCount: 2,
      symbolCount: 1,
      edgeCount: 1,
      graph,
    });
    const savedB = db.saveRepoMap({
      roomId: roomB.id,
      repoKey: "https://github.com/adityaraj-09/other",
      gitSha: "bbb",
      status: "ready",
      fileCount: 2,
      symbolCount: 1,
      edgeCount: 1,
      graph,
    });
    expect(savedA.status).toBe("ready");
    expect(savedB.status).toBe("ready");
    expect(savedA.id).not.toBe(savedB.id);
    const again = db.saveRepoMap({
      roomId: roomA.id,
      repoKey: "https://github.com/adityaraj-09/flowTape",
      gitSha: "aaa2",
      status: "ready",
      fileCount: 2,
      symbolCount: 1,
      edgeCount: 1,
      graph,
    });
    expect(again.status).toBe("ready");
    expect(again.git_sha).toBe("aaa2");
  });
});
