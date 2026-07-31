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
