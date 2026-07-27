import type { ModelInfo } from "../../shared/events";

const memory = new Map<string, { at: number; models: ModelInfo[] }>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const STORAGE_PREFIX = "steer-models:";

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

export function getCachedModels(key: string): ModelInfo[] | null {
  const mem = memory.get(key);
  if (mem && Date.now() - mem.at < TTL_MS) return mem.models;

  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; models: ModelInfo[] };
    if (!parsed?.models?.length) return null;
    if (Date.now() - parsed.at >= TTL_MS) return null;
    memory.set(key, parsed);
    return parsed.models;
  } catch {
    return null;
  }
}

export function setCachedModels(key: string, models: ModelInfo[]): void {
  if (!models.length) return;
  const entry = { at: Date.now(), models };
  memory.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

export const FALLBACK_MODELS: ModelInfo[] = [
  { id: "auto", displayName: "Auto" },
];
