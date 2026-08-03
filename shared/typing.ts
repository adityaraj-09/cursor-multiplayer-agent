/** Format a chat-style typing line scoped to one agent. */
export function formatTypingIndicator(
  names: string[],
  agentLabel: string,
): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  const target = agentLabel.trim() || "the agent";
  if (clean.length === 1) return `${clean[0]} is typing to ${target}…`;
  if (clean.length === 2) {
    return `${clean[0]} and ${clean[1]} are typing to ${target}…`;
  }
  return `${clean[0]} and ${clean.length - 1} others are typing to ${target}…`;
}

/** Aggregate typing across agents for the “All agents” chat view. */
export function formatTypingIndicatorAll(
  typingByAgent: Record<string, Array<{ name: string }>>,
  agents: Array<{ id: string; label: string }>,
): string {
  const labelById = new Map(agents.map((a) => [a.id, a.label]));
  const entries: Array<{ name: string; agentLabel: string }> = [];
  for (const [agentId, users] of Object.entries(typingByAgent)) {
    const agentLabel = labelById.get(agentId) || "agent";
    for (const u of users || []) {
      const name = (u.name || "").trim();
      if (name) entries.push({ name, agentLabel });
    }
  }
  if (entries.length === 0) return "";
  if (entries.length === 1) {
    return formatTypingIndicator([entries[0].name], entries[0].agentLabel);
  }
  const names = [...new Set(entries.map((e) => e.name))];
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}
