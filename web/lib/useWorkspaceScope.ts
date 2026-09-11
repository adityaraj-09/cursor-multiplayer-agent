"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createOrg,
  fetchOrgs,
  type OrgInfo,
} from "./api";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "./workspace";

export function workspaceCode(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "WS";
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return cleaned.slice(0, 3).toUpperCase();
}

export function useWorkspaceScope(initial?: WorkspaceScope) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [scope, setScope] = useState<WorkspaceScope>(initial || "personal");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgError, setOrgError] = useState("");
  const [busyOrg, setBusyOrg] = useState(false);

  useEffect(() => {
    if (initial) {
      setScope(initial);
      return;
    }
    setScope(readSelectedWorkspace());
  }, [initial]);

  const reloadOrgs = useCallback(async () => {
    const list = await fetchOrgs();
    setOrgs(list);
    const current = initial || readSelectedWorkspace();
    if (current !== "personal" && !list.some((org) => org.id === current)) {
      setScope("personal");
      writeSelectedWorkspace("personal");
    }
    return list;
  }, [initial]);

  const selectScope = useCallback((next: WorkspaceScope) => {
    setScope(next);
    writeSelectedWorkspace(next);
  }, []);

  const handleCreateOrg = useCallback(async () => {
    if (!newOrgName.trim()) {
      setOrgError("Team name is required");
      return;
    }
    setBusyOrg(true);
    setOrgError("");
    try {
      const org = await createOrg({ name: newOrgName.trim() });
      setOrgs((prev) =>
        [...prev, org].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCreatingOrg(false);
      setNewOrgName("");
      selectScope(org.id);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setBusyOrg(false);
    }
  }, [newOrgName, selectScope]);

  const orgId = scope === "personal" ? undefined : scope;
  const activeOrg = orgs.find((org) => org.id === scope) || null;
  const sessionCreateHref = orgId
    ? `/dashboard?compose=1&org=${encodeURIComponent(orgId)}`
    : "/dashboard?compose=1";

  return {
    orgs,
    setOrgs,
    scope,
    selectScope,
    creatingOrg,
    setCreatingOrg,
    newOrgName,
    setNewOrgName,
    orgError,
    setOrgError,
    busyOrg,
    handleCreateOrg,
    reloadOrgs,
    orgId,
    activeOrg,
    sessionCreateHref,
  };
}
