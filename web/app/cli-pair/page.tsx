"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DashboardShell from "../../components/DashboardShell";
import CreateTeamCard from "../../components/CreateTeamCard";
import { useAuth } from "../../components/AuthProvider";
import { createPairingCode } from "../../lib/api";
import { useWorkspaceScope } from "../../lib/useWorkspaceScope";

export default function CliPairPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const workspace = useWorkspaceScope();
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login?redirect=/cli-pair");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (loading || !user) return;
    workspace.reloadOrgs().catch(console.error);
  }, [loading, user, workspace.reloadOrgs]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await createPairingCode();
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create code");
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
      </div>
    );
  }

  return (
    <DashboardShell
      orgs={workspace.orgs}
      scope={workspace.scope}
      onSelectScope={workspace.selectScope}
      onNewTeam={() => workspace.setCreatingOrg((v) => !v)}
      creatingTeam={workspace.creatingOrg}
      createHref={workspace.sessionCreateHref}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
            Local worker
          </p>
          <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
            Pair CLI
          </h1>
          <p className="text-[13px] text-[#6e6e6e] mt-1 max-w-2xl leading-5">
            Connect the Steer CLI on your machine so Local sessions can run
            Cursor and Claude Code agents against a folder on your computer.
            Pairing links your signed-in account to that worker with a one-time
            code — keep{" "}
            <code className="text-[#a0a0a0]">steer start</code> running while
            you use Local sessions in the browser.
          </p>
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-[15px] font-medium text-[#e4e4e4]">
              Generate a pairing code
            </h2>
            <p className="text-[13px] text-[#6e6e6e] mt-1">
              Create a one-time code, then run{" "}
              <code className="text-[#a0a0a0]">steer login</code> on your
              machine and paste it when prompted.
            </p>
            <p className="text-[12px] text-[#6e6e6e] mt-2">
              Signed in as {user.email}
            </p>
          </div>

          {code ? (
            <div>
              <p className="text-[11px] text-[#6e6e6e] mb-2 uppercase tracking-wide">
                Pairing code
              </p>
              <div className="font-mono text-[28px] tracking-[0.2em] text-[#e4e4e4] text-center py-4 rounded-md bg-[#1a1a1a] border border-[#2b2b2b]">
                {code}
              </div>
              {expiresAt && (
                <p className="text-[11px] text-[#6e6e6e] mt-2 text-center">
                  Expires in ~10 minutes
                </p>
              )}
            </div>
          ) : null}

          {error && (
            <p className="text-[12px] text-[#f07070]">{error}</p>
          )}

          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className="h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors disabled:opacity-50"
          >
            {busy
              ? "Generating…"
              : code
                ? "Generate new code"
                : "Generate pairing code"}
          </button>

          <pre className="text-[11px] text-[#6e6e6e] bg-[#121212] rounded-md border border-[#2b2b2b] p-3 overflow-x-auto whitespace-pre-wrap">
{`npm i -g @oblivihon/steer
steer login
# Server URL: http://localhost:3000
# Pairing code: ${code || "XXXX-XXXX"}
steer start`}
          </pre>

          <p className="text-[12px] text-[#6e6e6e]">
            After pairing, open{" "}
            <Link
              href={workspace.sessionCreateHref}
              className="text-[#a0a0a0] hover:text-[#e4e4e4] transition-colors"
            >
              New session
            </Link>{" "}
            and choose a Local backend so prompts relay to your machine.
          </p>
        </section>
      </main>
      {workspace.creatingOrg && (
        <CreateTeamCard
          name={workspace.newOrgName}
          onNameChange={workspace.setNewOrgName}
          onCreate={() => void workspace.handleCreateOrg()}
          onCancel={() => workspace.setCreatingOrg(false)}
          busy={workspace.busyOrg}
          error={workspace.orgError}
        />
      )}
    </DashboardShell>
  );
}
