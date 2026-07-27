import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

export interface CursorChatSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  hasConversation: boolean;
}

interface SessionMeta {
  createdAtMs?: number;
  updatedAtMs?: number;
  hasConversation?: boolean;
  cwd?: string;
}

/** MD5 of resolved repo path — matches Cursor's ~/.cursor/chats layout. */
export function workspaceChatHash(repoPath: string): string {
  return createHash("md5").update(resolve(repoPath)).digest("hex");
}

export function listChatSessions(repoPath: string): CursorChatSession[] {
  const absRepo = resolve(repoPath);
  const root = join(homedir(), ".cursor", "chats", workspaceChatHash(absRepo));
  if (!existsSync(root)) return [];

  const sessions: CursorChatSession[] = [];
  for (const id of readdirSync(root, { withFileTypes: true })) {
    if (!id.isDirectory()) continue;
    const metaPath = join(root, id.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as SessionMeta;
      if (meta.cwd && resolve(meta.cwd) !== absRepo) continue;
      sessions.push({
        id: id.name,
        createdAt: meta.createdAtMs ?? 0,
        updatedAt: meta.updatedAtMs ?? meta.createdAtMs ?? 0,
        hasConversation: Boolean(meta.hasConversation),
      });
    } catch {
      // skip malformed entries
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}
