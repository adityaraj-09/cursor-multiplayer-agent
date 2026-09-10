type LogExtra = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function line(
  level: "info" | "warn" | "error",
  scope: string,
  message: string,
  extra?: LogExtra,
): string {
  const rec: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      rec[key] = serialize(value);
    }
  }
  return JSON.stringify(rec);
}

/** One-line JSON logs so Render's log viewer stays searchable. Never pass secrets. */
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
