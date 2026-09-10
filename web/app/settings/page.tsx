"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "../../components/DashboardShell";
import CreateTeamCard from "../../components/CreateTeamCard";
import GithubConnectCard from "../../components/settings/GithubConnectCard";
import IssuePickupCard from "../../components/settings/IssuePickupCard";
import OrgTeamSettings from "../../components/settings/OrgTeamSettings";
import WorkspaceKeysCard from "../../components/settings/WorkspaceKeysCard";
import { useAuth } from "../../components/AuthProvider";
import {
  fetchWorkspaceOverview,
  type WorkspaceGithubInfo,
  type WorkspaceKeyInfo,
} from "../../lib/api";
import { useWorkspaceScope, workspaceCode } from "../../lib/useWorkspaceScope";
import { writeSelectedWorkspace } from "../../lib/workspace";
import { canManageOrg } from "../../../shared/orgs";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        </div>
      }
    >
      <SettingsBody />
    </Suspense>
  );
}

function SettingsBody() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const workspace = useWorkspaceScope(search.get("org") || undefined);
  const [github, setGithub] = useState<WorkspaceGithubInfo | null>(null);
  const [keys, setKeys] = useState<WorkspaceKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;
    workspace.reloadOrgs().catch(console.error);
  }, [authLoading, user, workspace.reloadOrgs]);

  const selectScope = workspace.selectScope;

  useEffect(() => {
    const org = search.get("org");
    const githubStatus = search.get("github");
    const message = search.get("message");
    if (org && org !== "personal") {
      writeSelectedWorkspace(org);
      selectScope(org);
    }
    if (githubStatus === "connected") {
      setNotice("GitHub connected for this workspace");
    } else if (githubStatus === "error") {
      setError(message || "GitHub connect failed");
    }
    if (githubStatus || org) {
      router.replace("/settings", { scroll: false });
    }
  }, [search, router, selectScope]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoading(true);
    fetchWorkspaceOverview({ orgId: workspace.orgId })
      .then((data) => {
        if (cancelled) return;
        setGithub(data.github);
        setKeys(data.keys);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, workspace.orgId]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
        <Link href="/login?redirect=/settings" className="text-[#4d9fff] text-[13px]">
          Sign in
        </Link>
      </div>
    );
  }

  const label = workspace.activeOrg?.name || "Personal";
  const canManage = workspace.activeOrg
    ? canManageOrg(workspace.activeOrg.role)
    : true;

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
      <main className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
            {workspaceCode(label)} · {label}
          </p>
          <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
            Workspace settings
          </h1>
          <p className="text-[13px] text-[#6e6e6e] mt-1">
            GitHub, keys, and pickup for this workspace only. Switch workspaces
            in the sidebar to configure another.
          </p>
        </div>

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

        {(error || notice) && (
          <p className={`text-[13px] ${error ? "text-[#f07070]" : "text-[#3ecf8e]"}`}>
            {error || notice}
          </p>
        )}

        {loading || !github ? (
          <div className="h-40 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] animate-pulse" />
        ) : (
          <>
            <GithubConnectCard
              orgId={workspace.orgId}
              github={github}
              onChange={setGithub}
            />
            <WorkspaceKeysCard
              orgId={workspace.orgId}
              keys={keys}
              onChange={setKeys}
            />
            <IssuePickupCard orgId={workspace.orgId} canManage={canManage} />
            {workspace.orgId && (
              <OrgTeamSettings
                orgId={workspace.orgId}
                userId={user.id}
                onOrgChange={(org) => {
                  workspace.setOrgs((prev) =>
                    prev.map((item) => (item.id === org.id ? org : item)),
                  );
                }}
              />
            )}
          </>
        )}
      </main>
    </DashboardShell>
  );
}
