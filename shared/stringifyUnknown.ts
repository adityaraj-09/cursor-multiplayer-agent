const EMPTY = new Set(["", "[object Object]", "undefined", "null"]);

function isEmpty(text: string): boolean {
  return EMPTY.has(text.trim());
}

/**
 * Turn unknown thrown values / CLI payloads into a user-visible string.
 * Never returns "[object Object]".
 */
export function stringifyUnknown(
  value: unknown,
  fallback = "",
  depth = 0,
): string {
  if (value == null) return fallback;
  if (depth > 4) return fallback;

  if (typeof value === "string") {
    return isEmpty(value) ? fallback : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Error) {
    const msg = value.message?.trim();
    if (msg && !isEmpty(msg)) return msg;
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const nested = stringifyUnknown(cause, "", depth + 1);
      if (nested) return nested;
    }
    return value.name || fallback;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => stringifyUnknown(item, "", depth + 1))
      .filter((part) => part && !isEmpty(part));
    return parts.length ? parts.join("\n") : fallback;
  }

  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of [
      "message",
      "error",
      "detail",
      "description",
      "reason",
      "result",
      "stderr",
      "stdout",
      "text",
      "content",
    ]) {
      if (!(key in rec)) continue;
      const inner = stringifyUnknown(rec[key], "", depth + 1);
      if (inner && !isEmpty(inner)) return inner;
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "[]" && !isEmpty(json)) {
        return json.length > 800 ? `${json.slice(0, 800)}…` : json;
      }
    } catch {
      // circular / bigint
    }
  }

  return fallback;
}

export function errorMessage(err: unknown, fallback = "Unknown error"): string {
  const text = stringifyUnknown(err, "");
  return text && !isEmpty(text) ? text : fallback;
}
