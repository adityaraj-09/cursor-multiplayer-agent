import { createHash } from "crypto";

/**
 * `repo_map_nodes.id` is a global primary key. File/symbol ids are repo-relative
 * paths (`README.md`, `src/app.ts::main`), so two rooms scanning different
 * repos collide unless the row is scoped to the map.
 */
export function repoMapNodePk(mapId: string, nodeId: string): string {
  const raw = `${mapId}:${nodeId}`;
  if (raw.length <= 480) return raw;
  return `${mapId}:h:${createHash("sha1").update(nodeId).digest("hex")}`;
}
