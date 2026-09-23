import { Router, type Request, type Response, type Router as RouterType } from "express";
import { requireAuth } from "../auth.js";
import * as db from "../db.js";
import { logError } from "../logger.js";
import * as store from "./store.js";
import { buildSwarmExport, type SwarmExportScope } from "./exportBundle.js";
import {
  SwarmServiceError,
  actorCanViewSwarm,
  buildSwarmSnapshot,
  createSwarmForUser,
  decideBuildApproval,
  deleteSwarmForUser,
  pauseSwarm,
  postHumanDirective,
  resumeSwarm,
  startSwarm,
  stopSwarm,
  toSwarmInfo,
  updateSwarmSettings,
} from "./service.js";

const router: RouterType = Router();

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof SwarmServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logError("swarm", fallback, { err });
  res.status(500).json({ error: fallback });
}

function viewable(req: Request, res: Response): store.SwarmRow | null {
  const swarm = store.getSwarm(param(req.params.id));
  if (!swarm || !actorCanViewSwarm(swarm, req.user!.id)) {
    res.status(404).json({ error: "Swarm not found" });
    return null;
  }
  return swarm;
}

router.get("/", requireAuth, (req, res) => {
  const raw = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
  const orgId = raw && raw !== "personal" ? raw : null;
  if (orgId && !db.isOrganizationMember(orgId, req.user!.id)) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const rows = orgId ? store.listOrgSwarms(orgId) : store.listPersonalSwarms(req.user!.id);
  res.json(rows.map((row) => toSwarmInfo(row)));
});

router.post("/", requireAuth, (req, res) => {
  try {
    const swarm = createSwarmForUser(req.user!.id, req.body ?? {});
    res.status(201).json(buildSwarmSnapshot(swarm, req.user!.id));
  } catch (err) {
    fail(res, err, "Failed to create swarm");
  }
});

router.get("/:id", requireAuth, (req, res) => {
  const swarm = viewable(req, res);
  if (!swarm) return;
  res.json(buildSwarmSnapshot(swarm, req.user!.id));
});

router.patch("/:id", requireAuth, (req, res) => {
  try {
    const swarm = updateSwarmSettings(param(req.params.id), req.user!.id, req.body ?? {});
    res.json(buildSwarmSnapshot(swarm, req.user!.id));
  } catch (err) {
    fail(res, err, "Failed to update swarm");
  }
});

router.delete("/:id", requireAuth, (req, res) => {
  try {
    deleteSwarmForUser(param(req.params.id), req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Failed to delete swarm");
  }
});

const actions: Record<string, (id: string, userId: string, body: Record<string, unknown>) => unknown> = {
  start: (id, userId) => startSwarm(id, userId),
  pause: (id, userId) => pauseSwarm(id, userId),
  resume: (id, userId) => resumeSwarm(id, userId),
  stop: (id, userId) => stopSwarm(id, userId),
  approve: (id, userId, body) => decideBuildApproval(id, userId, { approve: true, note: body.note }),
  reject: (id, userId, body) => decideBuildApproval(id, userId, { approve: false, note: body.note }),
};

for (const [name, action] of Object.entries(actions)) {
  router.post(`/:id/${name}`, requireAuth, async (req, res) => {
    try {
      await action(param(req.params.id), req.user!.id, (req.body ?? {}) as Record<string, unknown>);
      const swarm = store.getSwarm(param(req.params.id))!;
      res.json(buildSwarmSnapshot(swarm, req.user!.id));
    } catch (err) {
      fail(res, err, `Failed to ${name} swarm`);
    }
  });
}

router.post("/:id/directives", requireAuth, (req, res) => {
  try {
    const post = postHumanDirective(param(req.params.id), req.user!.id, req.body ?? {});
    res.status(201).json(post);
  } catch (err) {
    fail(res, err, "Failed to post directive");
  }
});

router.get("/:id/agents/:agentId/messages", requireAuth, (req, res) => {
  const swarm = viewable(req, res);
  if (!swarm) return;
  const agent = store.getSwarmAgent(param(req.params.agentId));
  if (!agent || agent.swarmId !== swarm.id) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ notesMd: agent.notesMd, messages: store.listSwarmMessages(agent.id, 600) });
});

router.get("/:id/export", requireAuth, (req, res) => {
  const swarm = viewable(req, res);
  if (!swarm) return;
  const scope: SwarmExportScope = req.query.scope === "artifacts" ? "artifacts" : "full";
  try {
    const file = buildSwarmExport(swarm, scope);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Content-Length", String(file.body.length));
    res.send(file.body);
  } catch (err) {
    fail(res, err, "Failed to export swarm");
  }
});

router.get("/:id/artifacts/:artifactId", requireAuth, (req, res) => {
  const swarm = viewable(req, res);
  if (!swarm) return;
  const artifact = store.getSwarmArtifactContent(swarm.id, param(req.params.artifactId));
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.json(artifact);
});

router.get("/:id/ledger/revisions", requireAuth, (req, res) => {
  const swarm = viewable(req, res);
  if (!swarm) return;
  res.json(store.listSwarmLedgerRevisions(swarm.id, 50));
});

export default router;
