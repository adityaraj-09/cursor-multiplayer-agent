type LogExtra = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function formatValue(value: unknown): string {
  const v = serialize(value);
  if (v === null) return "null";
  if (typeof v === "string") {
    if (/\s/.test(v) || v.includes("=")) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function extraSuffix(extra?: LogExtra): string {
  if (!extra) return "";
  const bits: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    bits.push(`${key}=${formatValue(value)}`);
  }
  return bits.length ? `  ${bits.join(" ")}` : "";
}

function line(
  level: "info" | "warn" | "error",
  scope: string,
  message: string,
  extra?: LogExtra,
): string {
  return `${new Date().toISOString()}  ${level.toUpperCase().padEnd(5)}  ${scope}  ${message}${extraSuffix(extra)}`;
}

/** One-line readable logs. Never pass secrets. */
export function log(
  scope: string,
  message: string,
  extra?: LogExtra,
): void {
  console.log(line("info", scope, message, extra));
}

export function logWarn(
  scope: string,
  message: string,
  extra?: LogExtra,
): void {
  console.warn(line("warn", scope, message, extra));
}

export function logError(
  scope: string,
  message: string,
  extra?: LogExtra,
): void {
  console.error(line("error", scope, message, extra));
}

export const _test = { line, formatValue };
