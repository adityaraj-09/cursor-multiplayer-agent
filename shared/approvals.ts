/**
 * Approval gates for high-blast-radius agent actions.
 * Separate from file locks — these need a human sign-off in the room.
 */

export type ApprovalMode = "off" | "dangerous" | "all";
export type AgentMode = "agent" | "plan";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequestInfo {
  id: string;
  roomId: string;
  agentId: string;
  callId: string;
  toolName: string;
  detail: string;
  path?: string;
  status: ApprovalStatus;
  createdAt: number;
  decidedAt?: number;
  decidedByUserId?: string;
  decidedByName?: string;
}

export function parseApprovalMode(
  raw: unknown,
  fallback: ApprovalMode = "off",
): ApprovalMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "off" || v === "dangerous" || v === "all") return v;
  return fallback;
}

export function parseAgentMode(
  raw: unknown,
  fallback: AgentMode = "agent",
): AgentMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "plan" || v === "agent") return v;
  if (v === "true" || v === "1") return "plan";
  if (v === "false" || v === "0") return "agent";
  return fallback;
}

export function approvalModeLabel(mode: ApprovalMode): string {
  switch (mode) {
    case "off":
      return "No approvals";
    case "dangerous":
      return "Dangerous actions";
    case "all":
      return "All edits & shell";
  }
}

export function approvalModeDescription(mode: ApprovalMode): string {
  switch (mode) {
    case "off":
      return "Agents run tools without a second human sign-off.";
    case "dangerous":
      return "Migrations, deletes, pushes to main, CI/secrets changes pause for approval.";
    case "all":
      return "Every edit and shell command pauses for room approval.";
  }
}

export function agentModeLabel(mode: AgentMode): string {
  return mode === "plan" ? "Plan" : "Agent";
}

export function agentModeDescription(mode: AgentMode): string {
  return mode === "plan"
    ? "Read-only planning — the agent explores and proposes without editing."
    : "Full agent mode — the agent can edit files and run commands.";
}

/** Shell / terminal tool names across Cursor + Claude Code. */
const SHELL_TOOL_RE =
  /^(shell|bash|run_terminal_cmd|runterminalcmd|terminal|execute|command|Bash)$/i;

/** Explicit delete tools. */
const DELETE_TOOL_RE =
  /^(delete|deletefile|delete_file|Remove|remove)$/i;

/** High-blast-radius shell command patterns. */
const DANGEROUS_SHELL_RE =
  /\b(rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)|rm\s+-rf|rmdir\s+-r|sudo\s+|drop\s+(table|database|schema)|truncate\s+table|migrate|prisma\s+migrate|knex\s+migrate|django(-admin)?\s+migrate|rails\s+db:migrate|flyway|liquibase|git\s+push\s+.*\b(--force|-f)\b|git\s+push\s+.*\b(main|master)\b|git\s+branch\s+(-D|-d)\b|git\s+reset\s+--hard|git\s+clean\s+-f|kubectl\s+delete|terraform\s+destroy|helm\s+uninstall|dd\s+if=|mkfs\.|chmod\s+-R\s+777|curl\s+.*\|\s*(ba)?sh)\b/i;

/** Paths that need a second pair of eyes before edit/delete. */
const SENSITIVE_PATH_RE =
  /(^|\/)(\.env($|\.)|\.env\.[^/]+|.*secrets?.*|.*credentials?.*|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|\.npmrc|\.netrc|aws\/credentials|\.kube\/config|\.github\/workflows\/|Jenkinsfile|cloudbuild\.ya?ml|\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|buildkite\.ya?ml|circleci\/config\.ya?ml|travis\.ya?ml|Dockerfile|docker-compose.*\.ya?ml|terraform\/|.*\.tf$)/i;

export function isShellTool(name: string): boolean {
  const n = name.replace(/ToolCall$/i, "");
  return SHELL_TOOL_RE.test(n);
}

export function isDeleteTool(name: string): boolean {
  const n = name.replace(/ToolCall$/i, "");
  return DELETE_TOOL_RE.test(n) || /^delete/i.test(n);
}

export function isSensitivePath(path: string | undefined): boolean {
  if (!path?.trim()) return false;
  return SENSITIVE_PATH_RE.test(path.replace(/\\/g, "/"));
}

export function isDangerousShellCommand(detail: string | undefined): boolean {
  if (!detail?.trim()) return false;
  return DANGEROUS_SHELL_RE.test(detail);
}

/**
 * Whether this tool call should pause for human approval given the room mode.
 * `isEdit` is injected so we don't duplicate EDIT_TOOL_RE across modules.
 */
export function requiresApproval(opts: {
  mode: ApprovalMode;
  toolName: string;
  detail?: string;
  path?: string;
  isEditTool: (name: string) => boolean;
}): boolean {
  const { mode, toolName, detail, path, isEditTool } = opts;
  if (mode === "off") return false;

  const shell = isShellTool(toolName);
  const del = isDeleteTool(toolName);
  const edit = isEditTool(toolName);
  const sensitive = isSensitivePath(path) || isSensitivePath(detail);
  const dangerousShell = shell && isDangerousShellCommand(detail);

  if (mode === "all") {
    return shell || edit || del;
  }

  // dangerous
  return dangerousShell || del || (edit && sensitive) || (shell && sensitive);
}

/** Stable key so an approved action can be resumed without re-prompting. */
export function approvalActionKey(
  toolName: string,
  detail: string,
  path?: string,
): string {
  return `${toolName.trim().toLowerCase()}::${(path || "").trim()}::${detail.trim()}`.slice(
    0,
    500,
  );
}
