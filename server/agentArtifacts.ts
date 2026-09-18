import type { ChatAttachment } from "../shared/events.js";
import {
  artifactFileName,
  extractArtifactPaths,
  hasArtifactRefs,
  rewriteArtifactSrcs,
} from "../shared/agentArtifacts.js";
import {
  guessMime,
  saveUpload,
  toAttachment,
  type StoredUpload,
} from "./uploads.js";

/** Screen recordings can exceed the normal chat-upload cap. */
const ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;

export type ArtifactDownloader = (relativePath: string) => Promise<Buffer>;

export async function materializeArtifactsInText(opts: {
  text: string;
  roomId: string;
  download: ArtifactDownloader;
}): Promise<{ text: string; attachments: ChatAttachment[]; uploads: StoredUpload[] }> {
  const { text, roomId, download } = opts;
  if (!hasArtifactRefs(text)) {
    return { text, attachments: [], uploads: [] };
  }

  const paths = extractArtifactPaths(text);
  if (paths.length === 0) {
    return { text, attachments: [], uploads: [] };
  }

  const replacements = new Map<string, string>();
  const uploads: StoredUpload[] = [];
  const attachments: ChatAttachment[] = [];

  for (const rel of paths) {
    try {
      const data = await download(rel);
      if (!data?.length) continue;
      const name = artifactFileName(rel);
      const mime = guessMime(name);
      const rec = saveUpload({
        roomId,
        name,
        mime,
        data,
        maxBytes: ARTIFACT_MAX_BYTES,
      });
      const att = toAttachment(rec);
      replacements.set(rel, att.url);
      uploads.push(rec);
      attachments.push(att);
    } catch {
      // Leave the original path; chat still shows the tag text / broken media.
    }
  }

  return {
    text: rewriteArtifactSrcs(text, replacements),
    attachments,
    uploads,
  };
}
