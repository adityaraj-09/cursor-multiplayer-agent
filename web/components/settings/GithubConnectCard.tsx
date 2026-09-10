"use client";

import { useState } from "react";
import { GitFork } from "lucide-react";
import {
  connectWorkspaceGithubPat,
  disconnectWorkspaceGithub,
  startWorkspaceGithubOAuth,
  type WorkspaceGithubInfo,
} from "../../lib/api";

export default function GithubConnectCard({
  orgId,
  github,
  onChange,
}: {
  orgId?: string;
  github: WorkspaceGithubInfo;
  onChange: (next: WorkspaceGithubInfo) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connectOauth = async () => {
    setBusy(true);
    setError("");
    try {
      const url = await startWorkspaceGithubOAuth({ orgId });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start GitHub OAuth");
      setBusy(false);
    }
  };

  const connectPat = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await connectWorkspaceGithubPat(token.trim(), { orgId });
      setToken("");
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect GitHub");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect GitHub from this workspace?")) return;
    setBusy(true);
    setError("");
    try {
      onChange(await disconnectWorkspaceGithub({ orgId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[#252525] text-[#e4e4e4]">
            <GitFork className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-[#e4e4e4]">GitHub</h2>
            <p className="text-[12px] text-[#6e6e6e] mt-0.5">
              Issues only list repositories from the GitHub account connected to
              this workspace. Other workspaces can use a different account.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 text-[11px] px-2 py-1 rounded-md border ${
            github.connected
              ? "border-[#3ecf8e]/40 text-[#3ecf8e]"
              : "border-[#2b2b2b] text-[#a0a0a0]"
          }`}
        >
          {github.connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {github.connected ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#2b2b2b] bg-[#141414] px-3 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {github.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={github.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-full border border-[#2b2b2b] object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-[#252525]" />
            )}
            <div className="min-w-0">
              <p className="text-[13px] text-[#e4e4e4] truncate">
                {github.login ? `@${github.login}` : "GitHub connected"}
              </p>
              {github.hint && (
                <p className="text-[11px] text-[#6e6e6e] font-mono truncate">
                  {github.hint}
                </p>
              )}
            </div>
          </div>
          {github.canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="h-8 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#a0a0a0] hover:text-[#f07070] disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
      ) : github.canManage ? (
        <div className="mt-4 space-y-3">
          {github.oauthAvailable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectOauth()}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#e4e4e4] px-3 text-[13px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
            >
              <GitFork className="h-3.5 w-3.5" strokeWidth={1.75} />
              {busy ? "Connecting…" : "Connect GitHub"}
            </button>
          )}
          <div>
            <p className="text-[11px] text-[#6e6e6e] mb-1.5">
              {github.oauthAvailable
                ? "Or paste a personal access token with repo scope"
                : "Paste a GitHub personal access token with repo scope"}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                className="flex-1 h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] font-mono outline-none focus:border-[#4d9fff]"
                autoComplete="off"
              />
              <button
                type="button"
                disabled={busy || !token.trim()}
                onClick={() => void connectPat()}
                className="h-9 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
              >
                Save token
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-[#6e6e6e]">
          Ask a team admin to connect GitHub for this workspace.
        </p>
      )}

      {error && <p className="text-[12px] text-[#f07070] mt-3">{error}</p>}
    </section>
  );
}
