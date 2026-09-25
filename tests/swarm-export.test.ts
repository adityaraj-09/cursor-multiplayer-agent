import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildZip } from "../server/swarm/zipArchive.js";

let db: typeof import("../server/db.js");
let store: typeof import("../server/swarm/store.js");
let service: typeof import("../server/swarm/service.js");
let bundle: typeof import("../server/swarm/exportBundle.js");

const userId = `user_export_${randomUUID()}`;

function unzip(body: Buffer): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "swarm-zip-"));
  const file = join(dir, "archive.zip");
  writeFileSync(file, body);
  const raw = execFileSync(
    "python3",
    [
      "-c",
      "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode('utf-8','replace') for n in z.namelist()}))",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw) as Record<string, string>;
}

beforeAll(async () => {
  db = await import("../server/db.js");
  store = await import("../server/swarm/store.js");
  service = await import("../server/swarm/service.js");
  bundle = await import("../server/swarm/exportBundle.js");
  db.createUser(userId, `${userId}@example.com`, "Export Owner", "x");
});

describe("swarm export zip", () => {
  it("round-trips text through a real zip", () => {
    const body = buildZip([
      { path: "notes/readme.md", data: "hello swarm" },
      { path: "empty.txt", data: "" },
    ]);
    const files = unzip(body);
    expect(files["notes/readme.md"]).toBe("hello swarm");
    expect(files["empty.txt"]).toBe("");
    expect(() => buildZip([{ path: "../secret.txt", data: "nope" }])).toThrow(/unsafe zip path/i);
  });

  it("packs the swarm into folders for board, questions, agents, hypotheses, and artifacts", () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Compare demand-based addressed tokens with the current engine.",
      title: "Token research",
      repoUrl: "https://github.com/acme/engine",
      autoStart: false,
    });
    const orch = store.listSwarmAgents(swarm.id).find((a) => a.role === "orchestrator")!;
    store.updateSwarmAgent(orch.id, { notesMd: "Start from the checkout." });
    store.upsertSwarmMessages(swarm.id, [
      {
        id: "sm_export_1",
        agentId: orch.id,
        cycle: 1,
        role: "assistant",
        content: "Mapped the scheduler.",
        toolName: null,
        status: "done",
        ts: Date.now(),
      },
    ]);
    store.insertSwarmPost({
      swarmId: swarm.id,
      authorAgentId: orch.id,
      authorLabel: orch.label,
      authorRole: "orchestrator",
      channel: "questions",
      kind: "question",
      bodyMd: "Is fine-tuning allowed?",
    });
    const hypothesis = store.createSwarmHypothesis({
      swarmId: swarm.id,
      title: "Demand-based addresses",
      claimMd: "Address tokens by demand.",
      evidenceMd: "See the checkout.",
      authorAgentId: orch.id,
    });
    store.insertSwarmCritique({
      swarmId: swarm.id,
      hypothesisId: hypothesis.id,
      authorAgentId: orch.id,
      verdict: "support",
      score: 8,
      bodyMd: "Matches the current design.",
    });
    store.insertSwarmMatch({
      swarmId: swarm.id,
      hypothesisA: hypothesis.id,
      hypothesisB: hypothesis.id,
      winner: "draw",
      rationale: "Same idea.",
      judgeAgentId: orch.id,
    });
    store.saveSwarmLedger(swarm.id, { planMd: "1. Map the checkout" }, orch.id);
    store.upsertSwarmArtifact({
      swarmId: swarm.id,
      agentId: orch.id,
      kind: "report",
      name: "report.md",
      content: "# Report\n\nDemand-based addresses.",
    });
    store.insertSwarmEvent({ swarmId: swarm.id, agentId: orch.id, kind: "cycle_finished", message: "cycle 1" });

    const full = bundle.buildSwarmExport(store.getSwarm(swarm.id)!, "full", new Date("2026-09-23T12:00:00Z"));
    expect(full.filename).toBe("token-research-export.zip");
    const files = unzip(full.body);
    const root = "token-research";
    expect(files[`${root}/README.md`]).toContain("agents/");
    expect(files[`${root}/mission.md`]).toContain("https://github.com/acme/engine");
    expect(files[`${root}/board/questions.md`]).toContain("Is fine-tuning allowed?");
    expect(files[`${root}/agents/orchestrator/notes.md`]).toContain("Start from the checkout.");
    expect(files[`${root}/agents/orchestrator/cycles/001.md`]).toContain("Mapped the scheduler.");
    expect(files[`${root}/hypotheses/leaderboard.md`]).toContain("Demand-based addresses");
    expect(files[`${root}/hypotheses/matches.md`]).toContain("Same idea.");
    expect(Object.keys(files).some((p) => p.includes("/hypotheses/proposed/") && p.endsWith(".md"))).toBe(true);
    expect(files[`${root}/ledger/current.md`]).toContain("Map the checkout");
    expect(files[`${root}/artifacts/report/report.md`]).toContain("Demand-based addresses.");
    expect(files[`${root}/artifacts/manifest.json`]).toContain("report.md");
    expect(files[`${root}/activity/events.md`]).toContain("cycle_finished");
    expect(files[`${root}/data/posts.json`]).toContain("questions");
    expect(files[`${root}/data/agents.json`]).toContain("spawnedBy");
    expect(JSON.stringify(files)).not.toContain("tokenHash");

    const only = unzip(bundle.buildSwarmExport(store.getSwarm(swarm.id)!, "artifacts").body);
    expect(only[`${root}/artifacts/report/report.md`]).toContain("Demand-based addresses.");
    expect(Object.keys(only).some((p) => p.includes("/board/"))).toBe(false);
    expect(Object.keys(only).some((p) => p.includes("/agents/"))).toBe(false);
  });
});
