/** Paths Cursor cloud agents embed for walkthrough screenshots/videos. */

const ARTIFACT_ABS_PREFIX = "/opt/cursor/artifacts/";
const ARTIFACT_REL_PREFIX = "artifacts/";

/** Match src= on img/video tags, markdown images, and bare absolute artifact paths. */
const SRC_ATTR_RE =
  /(?:src\s*=\s*["']([^"']+)["']|!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\))/gi;

const BARE_ABS_PATH_RE =
  /(?:^|[\s"'=(>])(\/opt\/cursor\/artifacts\/[A-Za-z0-9._\-/\u2010-\u2015]+)/g;

export function isArtifactPath(path: string): boolean {
  const p = path.trim();
  return (
    p.startsWith(ARTIFACT_ABS_PREFIX) ||
    p.startsWith(ARTIFACT_REL_PREFIX) ||
    p.startsWith("./artifacts/")
  );
}

/**
 * Normalize agent-facing paths to the relative form the Cloud Artifacts API accepts
 * (e.g. `artifacts/demo.mp4`). Returns null if the path is not an artifact path.
 */
export function toRelativeArtifactPath(raw: string): string | null {
  let path = raw.trim();
  if (!path) return null;
  try {
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      path = u.pathname;
    }
  } catch {
    // keep raw
  }
  path = path.replace(/\\/g, "/");
  if (path.startsWith(ARTIFACT_ABS_PREFIX)) {
    path = ARTIFACT_REL_PREFIX + path.slice(ARTIFACT_ABS_PREFIX.length);
  } else if (path.startsWith("./artifacts/")) {
    path = path.slice(2);
  }
  if (!path.startsWith(ARTIFACT_REL_PREFIX)) return null;
  const rest = path.slice(ARTIFACT_REL_PREFIX.length);
  if (!rest || rest.includes("..") || rest.startsWith("/")) return null;
  return ARTIFACT_REL_PREFIX + rest;
}

export function hasArtifactRefs(text: string): boolean {
  if (!text) return false;
  return (
    text.includes(ARTIFACT_ABS_PREFIX) ||
    text.includes(ARTIFACT_REL_PREFIX) ||
    text.includes("./artifacts/")
  );
}

/** Unique relative artifact paths referenced in assistant text. */
export function extractArtifactPaths(text: string): string[] {
  if (!text || !hasArtifactRefs(text)) return [];
  const found = new Set<string>();

  SRC_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SRC_ATTR_RE.exec(text)) !== null) {
    const candidate = (m[1] || m[2] || "").trim();
    const rel = toRelativeArtifactPath(candidate);
    if (rel) found.add(rel);
  }

  BARE_ABS_PATH_RE.lastIndex = 0;
  while ((m = BARE_ABS_PATH_RE.exec(text)) !== null) {
    const rel = toRelativeArtifactPath(m[1]);
    if (rel) found.add(rel);
  }

  return [...found];
}

/** Assistant bubble ids for an agent that still embed unresolved artifact paths. */
export function assistantIdsNeedingArtifactHydration(
  messages: Array<{
    id: string;
    role: string;
    agentId?: string | null;
    content?: string | null;
  }>,
  agentId: string,
): string[] {
  return messages
    .filter(
      (m) =>
        m.agentId === agentId &&
        m.role === "assistant" &&
        hasArtifactRefs(m.content || ""),
    )
    .map((m) => m.id);
}

/**
 * Rewrite every occurrence of an absolute/relative artifact path to a served URL.
 * Keys in `replacements` must be relative (`artifacts/foo.webp`).
 */
export function rewriteArtifactSrcs(
  text: string,
  replacements: Map<string, string>,
): string {
  if (!text || replacements.size === 0) return text;

  let out = text;
  for (const [rel, url] of replacements) {
    const name = rel.slice(ARTIFACT_REL_PREFIX.length);
    const variants = [
      ARTIFACT_ABS_PREFIX + name,
      rel,
      "./" + rel,
    ];
    for (const variant of variants) {
      if (!variant || !out.includes(variant)) continue;
      out = out.split(variant).join(url);
    }
  }
  return out;
}

export function artifactFileName(relPath: string): string {
  const base = relPath.split("/").pop() || "artifact";
  return base.slice(0, 200) || "artifact";
}
