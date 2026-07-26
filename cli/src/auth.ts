import { loadConfig, saveConfig, clearConfig, type Config } from "./config.js";

export async function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<Config> {
  const url = `${serverUrl.replace(/\/+$/, "")}/api/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Server did not return a token");
  }

  const config: Config = {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    token: data.token,
    email,
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
