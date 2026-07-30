import { resolve, relative, isAbsolute } from "path";
import type { AgentConflict } from "../shared/events.js";

/**
 * Detect overlapping scope paths and shared touched files across agents.
 * NULL/undefined scope never triggers a scope warning (whole-repo agents).
 */
export function detectAgentConflicts(
  agents: Array<{
    id: string;
    status: string;
    scopePath?: string | null;
    touchedPaths: Iterable<string>;
  }>,
): AgentConflict[] {
  const active = agents.filter(
    (a) => a.status !== "stopped" && a.status !== "error",
  );
  const conflicts: AgentConflict[] = [];
  const seen = new Set<string>();

  const pathToAgents = new Map<string, string[]>();
  for (const a of active) {
    for (const p of a.touchedPaths) {
      const norm = normalizePath(p);
      if (!norm) continue;
      const list = pathToAgents.get(norm) || [];
      list.push(a.id);
      pathToAgents.set(norm, list);
    }
  }
  for (const [path, agentIds] of pathToAgents) {
    const unique = [...new Set(agentIds)];
    if (unique.length < 2) continue;
    const key = `file:${path}:${unique.sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ paths: [path], agentIds: unique });
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (!a.scopePath || !b.scopePath) continue;
      if (scopesOverlap(a.scopePath, b.scopePath)) {
        const agentIds = [a.id, b.id].sort();
        const key = `scope:${agentIds.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          paths: [normalizePath(a.scopePath)!, normalizePath(b.scopePath)!],
          agentIds,
        });
      }
    }
  }

  return conflicts;
}

export function scopesOverlap(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb + "/") || nb.startsWith(na + "/");
}

export function normalizePath(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
}

/**
 * Resolve an agent cwd under the room repo, rejecting path traversal.
 */
export interface ScopeOverlap {
  agentId: string;
  label: string;
  scopePath: string;
}

/**
 * Returns the first active agent whose explicit scope overlaps `proposedScope`.
 * Null/empty proposed scope never conflicts at scope level (whole-repo agents).
 */
export function findScopeOverlap(
  agents: Array<{
    id: string;
    label?: string;
    status: string;
    scopePath?: string | null;
  }>,
  proposedScope: string | null | undefined,
  excludeAgentId?: string,
): ScopeOverlap | null {
  const proposed = proposedScope ? normalizePath(proposedScope) : null;
  if (!proposed) return null;

  for (const a of agents) {
    if (excludeAgentId && a.id === excludeAgentId) continue;
    if (a.status === "stopped" || a.status === "error") continue;
    if (!a.scopePath) continue;
    if (scopesOverlap(proposed, a.scopePath)) {
      return {
        agentId: a.id,
        label: a.label || a.id.slice(0, 6),
        scopePath: normalizePath(a.scopePath)!,
      };
    }
  }
  return null;
}

export function formatScopeOverlapError(overlap: ScopeOverlap): string {
  return `Scope overlaps with agent "${overlap.label}" (${overlap.scopePath})`;
}

export function resolveAgentCwd(
  repoPath: string,
  scopePath: string | null | undefined,
): string {
  const base = resolve(repoPath);
  if (!scopePath || scopePath === "." || scopePath === "./") return base;
  const candidate = isAbsolute(scopePath)
    ? resolve(scopePath)
    : resolve(base, scopePath);
  const rel = relative(base, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `scope_path "${scopePath}" escapes the room repository`,
    );
  }
  return candidate;
}
