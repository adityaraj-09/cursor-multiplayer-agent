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

export function integrationBranchName(roomId: string, roomName?: string): string {
  const slug = slugifyBranchPart(roomName || "room", 20);
  const shortId = roomId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "room";
  return `steer/integration-${slug}-${shortId}`;
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
    `You are the room Integrator for “${input.roomName}”.`,
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
    `Required steps:`,
    `1. Fetch origin. If \`${input.integrationBranch}\` does not exist, create it from origin/${base} (or ${base} if origin is missing) and check it out. If it exists, check it out and fast-forward from origin if possible. Never reset it to discard commits.`,
    `2. Merge \`${input.source.branch}\` into \`${input.integrationBranch}\`.`,
    `3. If there are merge conflicts, resolve them so BOTH sides’ features remain. Never discard a feature to make the merge easy. Prefer combining both changes. If two implementations of the same thing conflict, keep both behind clear names/paths or compose them, and mention the conflict in the PR body.`,
    `4. Do not revert, reset --hard, or force-push in a way that drops commits already on \`${input.integrationBranch}\`.`,
    `5. After resolving conflicts, run a basic check if available (typecheck / lint / tests). Fix breakages caused by the merge without removing features.`,
    `6. Push \`${input.integrationBranch}\` to origin.`,
    `7. Open a pull request from \`${input.integrationBranch}\` into \`${base}\` if none exists for that head. If a PR already exists for this head branch, update its title/body to list every merged agent/branch. Do not open a second PR from a different head.`,
    `8. Reply with: integration branch, PR URL, which branches are included, and any conflict notes.`,
    ``,
    `Hard rules:`,
    `- Merging must preserve features from every agent already on the integration branch plus the source you are merging now.`,
    `- Do not work on a new personal feature branch. Stay on \`${input.integrationBranch}\`.`,
    `- Do not close or replace per-agent feature PRs. Those stay as-is.`,
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
