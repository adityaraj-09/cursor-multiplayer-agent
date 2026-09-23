import type { AgentUsageInfo } from "./events.js";

export type SdkUsageLike = {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  } | null;
  cost?: {
    rawCostCents?: number;
    chargedCents?: number;
  } | null;
} | null;

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function agentUsageFromSdk(raw: SdkUsageLike): AgentUsageInfo | null {
  if (!raw?.usage) return null;
  const usage = raw.usage;
  const info: AgentUsageInfo = {
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    cacheReadTokens: num(usage.cacheReadTokens),
    cacheWriteTokens: num(usage.cacheWriteTokens),
    totalTokens: num(usage.totalTokens),
    updatedAt: Date.now(),
  };
  if (usage.reasoningTokens != null) {
    info.reasoningTokens = num(usage.reasoningTokens);
  }
  if (raw.cost) {
    info.rawCostCents = num(raw.cost.rawCostCents);
    info.chargedCents = num(raw.cost.chargedCents);
  }
  return info;
}

export function parseAgentUsageJson(raw: unknown): AgentUsageInfo | undefined {
  if (!raw) return undefined;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const row = parsed as Record<string, unknown>;
  const totalTokens = num(row.totalTokens);
  const inputTokens = num(row.inputTokens);
  const outputTokens = num(row.outputTokens);
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }
  const info: AgentUsageInfo = {
    inputTokens,
    outputTokens,
    cacheReadTokens: num(row.cacheReadTokens),
    cacheWriteTokens: num(row.cacheWriteTokens),
    totalTokens: totalTokens || inputTokens + outputTokens,
    updatedAt: num(row.updatedAt) || Date.now(),
  };
  if (row.reasoningTokens != null) info.reasoningTokens = num(row.reasoningTokens);
  if (row.rawCostCents != null) info.rawCostCents = num(row.rawCostCents);
  if (row.chargedCents != null) info.chargedCents = num(row.chargedCents);
  return info;
}

export function formatTokenCount(n: number): string {
  const abs = Math.max(0, Math.round(n));
  if (abs < 1000) return `${abs}`;
  if (abs < 10_000) return `${(abs / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (abs < 1_000_000) return `${Math.round(abs / 1000)}k`;
  return `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatUsageCost(usage: AgentUsageInfo): string | null {
  const cents = Math.max(usage.chargedCents ?? 0, usage.rawCostCents ?? 0);
  if (!cents) return null;
  const usd = cents / 100;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 10 ? 2 : 2)}`;
}

export function formatAgentUsage(usage: AgentUsageInfo): string {
  const tokens = `${formatTokenCount(usage.totalTokens)} tok`;
  const cost = formatUsageCost(usage);
  return cost ? `${tokens} · ${cost}` : tokens;
}

export function formatAgentUsageDetail(usage: AgentUsageInfo): string {
  const parts = [
    `in ${formatTokenCount(usage.inputTokens)}`,
    `out ${formatTokenCount(usage.outputTokens)}`,
  ];
  if (usage.cacheReadTokens) {
    parts.push(`cache ${formatTokenCount(usage.cacheReadTokens)}`);
  }
  const cost = formatUsageCost(usage);
  if (cost) parts.push(cost);
  return parts.join(" · ");
}
