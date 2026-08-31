import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import * as db from "../db.js";
import type { RoomRow } from "../db/sqlite.js";
import { githubTokenFromEnv, parseGithubRepoUrl } from "../githubPr.js";
import { readGitSha, repoKeyFor, scanRepository } from "./scan.js";
import type { RepoMapGraph } from "../../shared/roomContext.js";
import type { RepoMapInfo } from "../../shared/roomContext.js";

const SCAN_TIMEOUT_MS = 180_000;

function cloneDirFor(repoUrl: string, ref: string): string {
  const safe = repoUrl.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60);
  return join(tmpdir(), "steer-maps", `${safe}-${ref.replace(/[^a-zA-Z0-9._-]/g, "")}`);
}

function tryClone(repoUrl: string, ref: string): string | null {
  const parsed = parseGithubRepoUrl(repoUrl);
  if (!parsed) return null;
  const dest = cloneDirFor(parsed.httpsUrl, ref);
  try {
    mkdirSync(dest, { recursive: true });
    const token = githubTokenFromEnv();
    const url = token
      ? parsed.httpsUrl.replace(
          "https://github.com/",
          `https://x-access-token:${token}@github.com/`,
        )
      : parsed.httpsUrl;
    if (!existsSync(join(dest, ".git"))) {
      execFileSync(
        "git",
        ["clone", "--depth", "1", "--branch", ref, url, dest],
        {
          timeout: SCAN_TIMEOUT_MS,
          stdio: "ignore",
        },
      );
    } else {
      execFileSync("git", ["fetch", "--depth", "1", "origin", ref], {
        cwd: dest,
        timeout: 60_000,
        stdio: "ignore",
      });
      execFileSync("git", ["checkout", "FETCH_HEAD"], {
        cwd: dest,
        timeout: 30_000,
        stdio: "ignore",
      });
    }
    return dest;
  } catch {
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return null;
  }
}

export function resolveScanRoot(row: RoomRow): string | null {
  if (row.repo_path && existsSync(row.repo_path)) return row.repo_path;
  if (row.runtime === "cloud" && row.repo_url) {
    return tryClone(row.repo_url, row.starting_ref || "main");
  }
  return null;
}

export function toRepoMapInfo(row: db.RepoMapRow): RepoMapInfo {
  return {
    id: row.id,
    roomId: row.room_id,
    repoKey: row.repo_key,
    gitSha: row.git_sha,
    status: row.status,
    error: row.error,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    edgeCount: row.edge_count,
    generatedAt: row.generated_at,
  };
}

export function loadRoomGraph(roomId: string): {
  map: RepoMapInfo | null;
  graph: RepoMapGraph | null;
} {
  const row = db.getRepoMap(roomId);
  if (!row) return { map: null, graph: null };
  return { map: toRepoMapInfo(row), graph: db.parseRepoMapGraph(row) };
}

export function ensureRoomRepoMap(
  row: RoomRow,
  opts?: { force?: boolean },
): RepoMapInfo {
  const existing = db.getRepoMap(row.id);
  const root = resolveScanRoot(row);
  const sha = root ? readGitSha(root) : null;
  if (
    !opts?.force &&
    existing &&
    existing.status === "ready" &&
    existing.git_sha &&
    sha &&
    existing.git_sha === sha
  ) {
    return toRepoMapInfo(existing);
  }
  if (!root) {
    const saved = db.saveRepoMap({
      roomId: row.id,
      repoKey: repoKeyFor(row.repo_path || "", row.repo_url),
      gitSha: null,
      status: "error",
      error: "No local checkout available to scan",
      fileCount: 0,
      symbolCount: 0,
      edgeCount: 0,
      graph: { nodes: [], edges: [] },
    });
    return toRepoMapInfo(saved);
  }
  try {
    const scanned = scanRepository(root, { repoUrl: row.repo_url });
    const saved = db.saveRepoMap({
      roomId: row.id,
      repoKey: scanned.repoKey,
      gitSha: scanned.gitSha,
      status: "ready",
      error: null,
      fileCount: scanned.fileCount,
      symbolCount: scanned.symbolCount,
      edgeCount: scanned.edgeCount,
      graph: scanned.graph,
    });
    return toRepoMapInfo(saved);
  } catch (err) {
    const saved = db.saveRepoMap({
      roomId: row.id,
      repoKey: repoKeyFor(root, row.repo_url),
      gitSha: sha,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      fileCount: existing?.file_count ?? 0,
      symbolCount: existing?.symbol_count ?? 0,
      edgeCount: existing?.edge_count ?? 0,
      graph: existing ? db.parseRepoMapGraph(existing) : { nodes: [], edges: [] },
    });
    return toRepoMapInfo(saved);
  }
}
