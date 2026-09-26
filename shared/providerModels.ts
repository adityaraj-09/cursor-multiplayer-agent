import type { ModelInfo } from "./events.js";
import { isCodexModelId } from "./codexModels.js";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=200";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

export function displayNameFromId(id: string): string {
  if (id === "auto") return "Auto";
  return id
    .replace(/^claude-/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First list wins id + display name; later lists only append new ids. */
export function mergeModelLists(
  ...lists: Array<ModelInfo[] | undefined | null>
): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const model of list) {
      const id = model?.id?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        displayName: model.displayName?.trim() || displayNameFromId(id),
        ...(model.description ? { description: model.description } : {}),
      });
    }
  }
  return out;
}

/** Keep a currently-selected id visible in the picker even if the catalog moved on. */
export function ensureModelPresent(
  models: ModelInfo[],
  modelId?: string | null,
): ModelInfo[] {
  const id = modelId?.trim();
  if (!id || models.some((m) => m.id === id)) return models;
  return [...models, { id, displayName: displayNameFromId(id) }];
}

function asRecordArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    );
  }
  if (json && typeof json === "object") {
    const rec = json as Record<string, unknown>;
    const nested = rec.data ?? rec.models ?? rec.items;
    if (Array.isArray(nested)) {
      return nested.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      );
    }
  }
  return [];
}

function createdMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function parseAnthropicModelsResponse(json: unknown): ModelInfo[] {
  const rows = asRecordArray(json)
    .map((rec) => {
      const id = String(rec.id || "").trim();
      if (!id) return null;
      const displayName = String(
        rec.display_name || rec.displayName || "",
      ).trim();
      return {
        id,
        displayName: displayName || displayNameFromId(id),
        created: createdMs(rec.created_at ?? rec.createdAt ?? rec.created),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  rows.sort((a, b) => b.created - a.created);
  return rows.map(({ id, displayName }) => ({ id, displayName }));
}

function isExcludedOpenaiModel(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("embed") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("dall-e") ||
    lower.includes("davinci") ||
    lower.includes("babbage") ||
    lower.includes("ada-") ||
    lower.includes("realtime") ||
    lower.includes("transcribe") ||
    lower.includes("moderation") ||
    lower.includes("image") ||
    lower.includes("audio") ||
    lower.includes("sora") ||
    lower.startsWith("ft:")
  );
}

function openaiRank(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("codex")) return 0;
  if (lower.startsWith("gpt-6")) return 1;
  if (lower.startsWith("gpt-5")) return 2;
  if (lower.startsWith("o4") || lower.startsWith("o3")) return 3;
  if (lower.startsWith("gpt-4")) return 4;
  return 5;
}

export function parseOpenaiModelsResponse(json: unknown): ModelInfo[] {
  const rows = asRecordArray(json)
    .map((rec) => {
      const id = String(rec.id || rec.slug || rec.model || "").trim();
      if (!id || isExcludedOpenaiModel(id) || !isCodexModelId(id)) return null;
      return { id, created: createdMs(rec.created) };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  rows.sort((a, b) => {
    const rank = openaiRank(a.id) - openaiRank(b.id);
    if (rank !== 0) return rank;
    return b.created - a.created;
  });

  return rows.map(({ id }) => ({ id, displayName: displayNameFromId(id) }));
}

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MODEL_LINE_RE = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\s+[-–—|:]\s+(.+)$/;
const MODEL_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "");
}

function modelFromUnknown(value: unknown): ModelInfo | null {
  if (typeof value === "string") {
    const id = value.trim();
    if (!id || !MODEL_TOKEN_RE.test(id) || !isCodexModelId(id)) return null;
    return { id, displayName: displayNameFromId(id) };
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const id = String(rec.id || rec.slug || rec.model || rec.name || "").trim();
  if (!id || !isCodexModelId(id)) return null;
  const displayName = String(
    rec.display_name || rec.displayName || rec.label || rec.name || "",
  ).trim();
  return {
    id,
    displayName: displayName && displayName !== id ? displayName : displayNameFromId(id),
  };
}

function parseCodexDebugJson(json: unknown): ModelInfo[] {
  if (Array.isArray(json)) {
    return mergeModelLists(json.map(modelFromUnknown).filter((m): m is ModelInfo => Boolean(m)));
  }
  if (json && typeof json === "object") {
    const rec = json as Record<string, unknown>;
    const nested = rec.models ?? rec.data ?? rec.items ?? rec.available;
    if (nested) return parseCodexDebugJson(nested);
  }
  return [];
}

/** Parse `codex debug models` — JSON, "id — label" lines, or bare ids. */
export function parseCodexDebugModels(stdout: string): ModelInfo[] {
  const text = stripAnsi(stdout || "").trim();
  if (!text) return [];

  const jsonStart = text.indexOf("[") >= 0 && (text.indexOf("{") < 0 || text.indexOf("[") < text.indexOf("{"))
    ? text.indexOf("[")
    : text.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = parseCodexDebugJson(JSON.parse(text.slice(jsonStart)));
      if (parsed.length) return parsed;
    } catch {
      // fall through to line parser
    }
  }

  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^(available models|models):?$/i.test(line)) continue;
    const labeled = line.match(MODEL_LINE_RE);
    const id = (labeled?.[1] || line.split(/\s+/)[0] || "").trim();
    if (!id || !MODEL_TOKEN_RE.test(id) || !isCodexModelId(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = labeled?.[2]?.trim();
    models.push({
      id,
      displayName: label && label !== id ? label : displayNameFromId(id),
    });
  }
  return models;
}

export async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const key = apiKey.trim();
  if (!key) throw new Error("Anthropic API key is required to list models");
  const res = await fetch(ANTHROPIC_MODELS_URL, {
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic models request failed (${res.status})`);
  }
  return parseAnthropicModelsResponse(await res.json());
}

export async function fetchOpenaiCodingModels(apiKey: string): Promise<ModelInfo[]> {
  const key = apiKey.trim();
  if (!key) throw new Error("OpenAI API key is required to list models");
  const res = await fetch(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI models request failed (${res.status})`);
  }
  return parseOpenaiModelsResponse(await res.json());
}
