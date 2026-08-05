/**
 * Git attribution helpers — turn Steer chat authorship into commit metadata
 * that shows up in git blame / PR review.
 */

export interface SteerAuthor {
  userId?: string;
  name: string;
  email?: string;
}

/** Normalize a display name into a noreply-style local-part. */
export function noreplyLocalPart(name: string, userId?: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  if (userId?.trim()) {
    const id = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
    return `${id}+${slug || "steer-user"}`;
  }
  return slug || "steer-user";
}

export function resolveAuthorEmail(author: SteerAuthor): string {
  const email = author.email?.trim();
  if (email && email.includes("@")) return email;
  return `${noreplyLocalPart(author.name, author.userId)}@users.noreply.github.com`;
}

export function formatCoAuthoredBy(author: SteerAuthor): string {
  const name = author.name.trim() || "Steer user";
  return `Co-authored-by: ${name} <${resolveAuthorEmail(author)}>`;
}

/**
 * Full commit message with optional Co-authored-by trailer.
 * Trailers must be separated from the subject/body by a blank line.
 */
export function buildAttributedCommitMessage(
  summary: string,
  steeredBy?: SteerAuthor | null,
): string {
  const subject = (summary || "steer: agent changes").trim().slice(0, 72);
  if (!steeredBy?.name?.trim()) return subject;
  return `${subject}\n\n${formatCoAuthoredBy(steeredBy)}`;
}

/**
 * Instruction injected into agent prompts so local Cursor/Claude CLI runs
 * (where we don't control git commit ourselves) still attribute the steerer.
 */
export function attributionPromptSuffix(steeredBy?: SteerAuthor | null): string {
  if (!steeredBy?.name?.trim()) return "";
  const trailer = formatCoAuthoredBy(steeredBy);
  return [

    "",
    "[Steer attribution]",
    "When you create a git commit for this work, include this exact trailer",
    "at the end of the commit message (after a blank line):",
    "",
    trailer,
    "",
    "Do not invent other co-authors. Keep the subject line concise.",
  ].join("\n");
}

/** Short line for PR bodies / chat system notes. */
export function steeredByLine(steeredBy?: SteerAuthor | null): string {
  if (!steeredBy?.name?.trim()) return "";
  return `Steered by: ${steeredBy.name.trim()} <${resolveAuthorEmail(steeredBy)}>`;
}
