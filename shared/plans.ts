/** Whether an assistant reply looks like a finished plan document. */
export function looksLikePlan(content: string): boolean {
  const t = content.trim();
  if (t.length < 80) return false;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/\b(plan|steps?|implementation|proposal|approach)\b/i.test(t)) return true;
  return t.length >= 240;
}

export function planImplementPrompt(plan: string): string {
  return [
    "The plan below was approved by the room. Exit plan/read-only mode and implement it now.",
    "Do not ask for approval again for this plan. Start making the changes.",
    "",
    plan.trim(),
  ].join("\n");
}
