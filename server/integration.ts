import { isClaudeModelId } from "../shared/claudeModels.js";
import { slugifyBranchPart } from "./githubPr.js";

export interface IntegrateAgentSnapshot {
  id: string;
  label: string;
  branch?: string | null;
  prUrl?: string | null;
  kind?: string | null;
  status?: string | null;
}

export interface BuildIntegratePromptInput {
  roomName: string;
  repoUrl: string;
  startingRef: string;
  integrationBranch: string;
  existingPrUrl?: string | null;
  source: IntegrateAgentSnapshot;
  agents: IntegrateAgentSnapshot[];
}

/** Integrator must be a live Cursor agent so it can fetch every feature branch. */
export function isUsableIntegrator(agent: {
  kind?: string | null;
  backend?: string | null;
  status?: string | null;
}): boolean {
  return (
    agent.kind === "integrator" &&
    agent.backend === "cursor" &&
    agent.status !== "stopped"
  );
}

/**
 * Cursor Cloud reports its own sandbox branch/PR. Never let that replace the
 * room integration branch, or Integrate will lose the feature branches.
 */
export function resolveIntegratorGitResult(input: {
  assignedBranch?: string | null;
  reportedBranch?: string | null;
  reportedPrUrl?: string | null;
  existingPrUrl?: string | null;
}): { branch: string | null; prUrl: string | null } {
  const assigned = input.assignedBranch?.trim() || "";
  const reported = input.reportedBranch?.trim() || "";
  const sameHead =
    Boolean(assigned && reported) &&
    assigned.replace(/^origin\//, "") === reported.replace(/^origin\//, "");
  const reportedPr = input.reportedPrUrl?.trim() || "";
  return {
    branch: assigned || reported || null,
    prUrl:
      sameHead && reportedPr
        ? reportedPr
        : input.existingPrUrl?.trim() || null,
  };
}

/** Cursor SDK rejects Claude model ids — keep the Integrator on a Cursor model. */
export function cursorModelForIntegrator(
  sourceModel?: string | null,
  roomModel?: string | null,
  fallback = "composer-2.5",
): string {
  for (const id of [sourceModel, roomModel]) {
    const trimmed = id?.trim();
    if (trimmed && !isClaudeModelId(trimmed)) return trimmed;
  }
  return fallback;
}

export function isBaseBranch(branch: string | null | undefined, startingRef = "main"): boolean {
  const head = branch?.trim().replace(/^origin\//, "");
  const base = startingRef.trim().replace(/^origin\//, "") || "main";
  if (!head) return false;
  return head === base || head === "main" || head === "master";
}

export function liveFeatureAgents<T extends { kind?: string | null; status?: string | null }>(
  agents: T[],
): T[] {
  return agents.filter(
    (agent) => agent.kind !== "integrator" && agent.status !== "stopped",
  );
}

/** Platform instructions for feature agents — equivalent of a per-agent cursor.md. */
export function buildFeatureAgentGitRules(input: {
  agentLabel: string;
  assignedBranch?: string | null;
  startingRef?: string | null;
}): string {
  const base = input.startingRef?.trim() || "main";
  const assigned = input.assignedBranch?.trim();
  const branchLine = assigned
    ? `Your assigned feature branch is \`${assigned}\`. Stay on this branch for the entire session.`
    : `Steer will create a dedicated feature branch for you. Stay on that branch for the entire session.`;
  return [
    `<steer_git_rules>`,
    `You are feature agent “${input.agentLabel}” in a Steer room. A human will later click Integrate to combine agent branches.`,
    branchLine,
    `Never checkout, create, or push extra branches. If you already made another branch, merge that work back onto your assigned branch and stay there.`,
    `Never push, merge, reset, or force-push to \`${base}\` (or main/master). Do not commit on \`${base}\`.`,
    `Do not open a pull request targeting \`${base}\`. Integrate does that.`,
    `Do not merge other agents’ feature branches or the room integration branch.`,
    `Keep your work mergeable: small focused commits, no deleting unrelated files, no rewriting shared history.`,
    `</steer_git_rules>`,
  ].join("\n");
}

export function integrationBranchName(roomId: string, roomName?: string): string {
  const slug = slugifyBranchPart(roomName || "room", 20);
  const shortId = roomId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "room";
  return `steer/integration-${slug}-${shortId}`;
}

export function extractGithubPrUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(
    /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/i,
  );
  return match?.[0] ?? null;
}

export function featureAgentSnapshots(
  agents: IntegrateAgentSnapshot[],
): IntegrateAgentSnapshot[] {
  return agents.filter(
    (agent) => agent.kind !== "integrator" && agent.status !== "stopped",
  );
}

export function buildIntegratePrompt(input: BuildIntegratePromptInput): string {
  const base = input.startingRef.trim() || "main";
  const others = featureAgentSnapshots(input.agents).filter(
    (agent) => agent.id !== input.source.id,
  );
  const otherLines = others.length
    ? others
        .map((agent) => {
          const branch = agent.branch?.trim() || "(no branch yet)";
          const pr = agent.prUrl?.trim() ? ` PR: ${agent.prUrl}` : "";
          return `- ${agent.label} (${agent.id}): \`${branch}\`${pr}`;
        })
        .join("\n")
    : "- none yet";

  const existingPr = input.existingPrUrl?.trim() || "none";

  return [
    `You are the room Integrator for “${input.roomName}”. You run as a Cursor cloud agent with your own checkout.`,
    `Your only job is to combine agent feature branches into ONE shared integration branch and keep ONE pull request up to date.`,
    ``,
    `GitHub repo: ${input.repoUrl}`,
    `PR base / starting ref: \`${base}\``,
    `Integration branch (your working branch and the PR head): \`${input.integrationBranch}\``,
    `Existing integration PR: ${existingPr}`,
    ``,
    `Source agent to merge NOW: ${input.source.label} (${input.source.id})`,
    `Source branch: \`${input.source.branch || ""}\``,
    input.source.prUrl ? `Source agent PR (do not replace this): ${input.source.prUrl}` : "",
    ``,
    `Other known feature agents in this room — do not drop their work if it is already on the integration branch:`,
    otherLines,
    ``,
    `Work in this agent’s own dedicated checkout. Do not reuse another agent’s dirty worktree.`,
    `Cursor Cloud may start you on its own sandbox branch. Immediately checkout \`${input.integrationBranch}\` and stay there. Do not open a PR from the sandbox branch.`,
    `Feature branches (Cursor SDK names and \`steer/claude-*\`) live on origin — they are not in your clone until you fetch.`,
    ``,
    `Required steps:`,
    `1. Fetch origin (all remotes). If \`${input.integrationBranch}\` does not exist, create it from origin/${base} (or ${base} if origin is missing) and check it out. If it exists, check it out and fast-forward from origin if possible. Never reset it to discard commits.`,
    `2. Sync with \`${base}\` FIRST: merge origin/${base} into \`${input.integrationBranch}\` (merge, do not rebase). Resolve any main-vs-integration conflicts so existing integrated features and main both survive. This keeps the PR diff current.`,
    `3. Merge \`${input.source.branch}\` into \`${input.integrationBranch}\`.`,
    `4. If there are merge conflicts, resolve them so BOTH sides’ features remain. Never discard a feature to make the merge easy. Prefer combining both changes. If two implementations of the same thing conflict, keep both behind clear names/paths or compose them, and mention the conflict in your summary.`,
    `5. Do not revert, reset --hard, or force-push in a way that drops commits already on \`${input.integrationBranch}\`. If the remote moved, fetch and merge again — never force-push.`,
    `6. HARD GATE before push: run the strongest available check (tests, otherwise typecheck / lint). If checks fail, fix breakages caused by the merge without removing features. Do not push, do not open/update the PR, and report the failure if checks still fail.`,
    `7. Only after checks pass: push \`${input.integrationBranch}\` to origin.`,
    `8. REQUIRED: open or update ONE pull request from \`${input.integrationBranch}\` into \`${base}\`. This environment can create PRs — do it now. Do not wait for human approval. Do not say the PR is queued or waiting. If needed run \`gh pr create --head ${input.integrationBranch} --base ${base}\` (or update the existing PR for that head). Never open a PR from any other branch.`,
    `9. Reply with: integration branch, the live PR URL, which branches are included, a conflict-resolution summary (what overlapped and how both sides were kept), and the checks you ran.`,
    ``,
    `Hard rules:`,
    `- Merging must preserve features from every agent already on the integration branch plus the source you are merging now.`,
    `- Do not work on a new personal feature branch. Stay on \`${input.integrationBranch}\`.`,
    `- Do not close or replace per-agent feature PRs. Those stay as-is.`,
    `- Do not self-certify “both features preserved” without listing the overlapping files and how you kept both sides.`,
    `- Do not finish without a real GitHub pull request URL whose head is \`${input.integrationBranch}\`.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildIntegrationPrBody(input: {
  roomName: string;
  startingRef: string;
  integrationBranch: string;
  agents: IntegrateAgentSnapshot[];
  sourceId?: string;
  notes?: string;
}): string {
  const base = input.startingRef.trim() || "main";
  const features = featureAgentSnapshots(input.agents).filter((agent) =>
    Boolean(agent.branch?.trim()),
  );
  const lines = features.map((agent) => {
    const marker = agent.id === input.sourceId ? " (just merged)" : "";
    const pr = agent.prUrl?.trim() ? ` — ${agent.prUrl}` : "";
    return `- ${agent.label}: \`${agent.branch}\`${marker}${pr}`;
  });
  return [
    `Combined integration PR from Steer room “${input.roomName}”.`,
    ``,
    `Head: \`${input.integrationBranch}\` → \`${base}\``,
    ``,
    `Included agent branches:`,
    ...(lines.length ? lines : ["- (none recorded yet)"]),
    ``,
    `Conflict policy: keep every agent’s features. Do not drop work to make a merge look clean.`,
    input.notes?.trim() ? `\nNotes:\n${input.notes.trim()}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildIntegrationPrComment(input: {
  sourceLabel: string;
  sourceBranch: string;
  integrationBranch: string;
  notes?: string;
}): string {
  const notes = input.notes?.trim();
  return [
    `### Integration update`,
    ``,
    `Merged **${input.sourceLabel}** (\`${input.sourceBranch}\`) into \`${input.integrationBranch}\`.`,
    ``,
    notes ? notes : "No conflict-resolution notes were returned by the Integrator.",
    ``,
    `_Please spot-check that both features survived. Tests/typecheck were a hard gate before this push._`,
  ].join("\n");
}
