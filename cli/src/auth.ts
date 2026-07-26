import { saveConfig, clearConfig, loadConfig, type Config } from "./config.js";

/** Pair CLI with a Clerk-authenticated web account via one-time code. */
export async function loginWithPairingCode(
  serverUrl: string,
  code: string,
): Promise<Config> {
  const base = serverUrl.replace(/\/+$/, "");
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  const res = await fetch(`${base}/api/auth/pairing/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: normalized }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Pairing failed (${res.status})`);
  }

  const data = (await res.json()) as {
    token: string;
    user: { email: string };
  };

  const config: Config = {
    serverUrl: base,
    token: data.token,
    email: data.user.email,
  };
  saveConfig(config);
  return config;
}

export function logout(): void {
  clearConfig();
}

export function getAuthHeaders(): Record<string, string> {
  const config = loadConfig();
  if (!config) {
    throw new Error("Not logged in. Run `steer login` first.");
  }
  return { Authorization: `Bearer ${config.token}` };
}
