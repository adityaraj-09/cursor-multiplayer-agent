"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RoomCard from "../../components/RoomCard";
import UserMenu from "../../components/UserMenu";
import { useAuth } from "../../components/AuthProvider";
import {
  createOrg,
  fetchJoinableOrgs,
  fetchOrgs,
  fetchRooms,
  joinOrgByDomain,
  type OrgInfo,
} from "../../lib/api";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "../../lib/workspace";
import type { RoomInfo } from "../../../shared/events";
import { canManageOrg } from "../../../shared/orgs";

export default function SessionsDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [joinable, setJoinable] = useState<
    Array<{ id: string; name: string; slug: string; allowedDomains: string[] }>
  >([]);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgError, setOrgError] = useState("");
  const [busyOrg, setBusyOrg] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("notice");
    if (!raw) return;
    setNotice(raw);
    params.delete("notice");
    const next = params.toString();
    const path = next
      ? `${window.location.pathname}?${next}`
      : window.location.pathname;
    window.history.replaceState({}, "", path);
  }, []);

  useEffect(() => {
    setScope(readSelectedWorkspace());
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    Promise.all([fetchOrgs(), fetchJoinableOrgs()])
      .then(([orgList, joinList]) => {
        if (cancelled) return;
        setOrgs(orgList);
        setJoinable(joinList);
        const current = readSelectedWorkspace();
        if (
          current !== "personal" &&
          !orgList.some((o) => o.id === current)
        ) {
          setScope("personal");
          writeSelectedWorkspace("personal");
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRooms([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const orgId = scope === "personal" ? "personal" : scope;
    fetchRooms({ orgId })
      .then((r) => {
        if (!cancelled) setRooms(r);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = setInterval(() => {
      fetchRooms({ orgId })
        .then((r) => {
          if (!cancelled) setRooms(r);
        })
        .catch(console.error);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, authLoading, scope]);

  const selectScope = (next: WorkspaceScope) => {
    setScope(next);
    writeSelectedWorkspace(next);
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) {
      setOrgError("Team name is required");
      return;
    }
    setBusyOrg(true);
    setOrgError("");
    try {
      const org = await createOrg({ name: newOrgName.trim() });
      setOrgs((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
      setCreatingOrg(false);
      setNewOrgName("");
      selectScope(org.id);
      setNotice(`Created team “${org.name}”`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setBusyOrg(false);
    }
  };

  const handleJoinDomain = async (orgId: string) => {
    setBusyOrg(true);
    setOrgError("");
    try {
      const org = await joinOrgByDomain(orgId);
      setOrgs((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
      setJoinable((prev) => prev.filter((j) => j.id !== orgId));
      selectScope(org.id);
      setNotice(`Joined team “${org.name}”`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to join team");
    } finally {
      setBusyOrg(false);
    }
  };

  const activeOrg = orgs.find((o) => o.id === scope) || null;
  const createHref =
    scope === "personal" ? "/create" : `/create?org=${encodeURIComponent(scope)}`;

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
        <div className="text-center">
          <p className="text-[#a0a0a0] text-[14px] mb-5">
            Sign in to view your sessions.
          </p>
          <Link
            href="/login?redirect=/dashboard"
            className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414]">
      <header className="border-b border-[#2b2b2b]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-6 h-6 rounded-[5px] bg-[#e4e4e4] flex items-center justify-center shrink-0">
              <span className="text-[#141414] text-[11px] font-semibold">S</span>
            </div>
            <span className="text-[14px] font-medium text-[#e4e4e4]">
              Steer
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <Link
              href="/cli-pair"
              className="h-7 px-2 sm:px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors flex items-center"
            >
              Pair CLI
            </Link>
            <Link
              href="/profile"
              className="h-7 px-2 sm:px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors hidden sm:flex items-center"
            >
              Profile
            </Link>
            <UserMenu />
            <Link
              href={createHref}
              className="h-8 px-2.5 sm:px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors flex items-center"
            >
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New session</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {notice && (
          <div className="mb-5 flex items-start gap-3 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-3.5 py-3">
            <p className="flex-1 text-[13px] text-[#e4e4e4] leading-5">
              {notice}
            </p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4] transition-colors"
              aria-label="Dismiss notice"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
              Sessions
            </h1>
            <p className="text-[13px] text-[#6e6e6e] mt-1">
              {activeOrg
                ? `All active rooms across ${activeOrg.name}`
                : "Your personal multiplayer agent rooms"}
            </p>
          </div>
          {activeOrg && (
            <Link
              href={`/org/${activeOrg.id}/settings`}
              className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors inline-flex items-center self-start"
            >
              {canManageOrg(activeOrg.role) ? "Team settings" : "Team"}
            </Link>
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectScope("personal")}
            className={`h-8 px-3 rounded-md text-[12px] border transition-colors ${
              scope === "personal"
                ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
            }`}
          >
            Personal
          </button>
          {orgs.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => selectScope(org.id)}
              className={`h-8 px-3 rounded-md text-[12px] border transition-colors ${
                scope === org.id
                  ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                  : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
              }`}
            >
              {org.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCreatingOrg((v) => !v);
              setOrgError("");
            }}
            className="h-8 px-3 rounded-md text-[12px] border border-dashed border-[#2b2b2b] text-[#6e6e6e] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors"
          >
            + New team
          </button>
        </div>

        {creatingOrg && (
          <div className="mb-6 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4">
            <p className="text-[13px] text-[#e4e4e4] mb-2">Create a team workspace</p>
            <p className="text-[11px] text-[#6e6e6e] mb-3">
              Sessions created in this team are visible to all members. Set a
              shared Cursor key in Team settings so leads don’t configure billing
              per room.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Acme Engineering"
                className="flex-1 h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
              />
              <button
                type="button"
                disabled={busyOrg}
                onClick={() => void handleCreateOrg()}
                className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
              >
                {busyOrg ? "Creating…" : "Create team"}
              </button>
            </div>
            {orgError && (
              <p className="text-[12px] text-[#f07070] mt-2">{orgError}</p>
            )}
          </div>
        )}

        {joinable.length > 0 && (
          <div className="mb-6 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4">
            <p className="text-[13px] text-[#e4e4e4] mb-1">Join your company team</p>
            <p className="text-[11px] text-[#6e6e6e] mb-3">
              These teams allow your email domain to join automatically.
            </p>
            <div className="space-y-2">
              {joinable.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#e4e4e4] truncate">{org.name}</p>
                    <p className="text-[11px] text-[#6e6e6e]">
                      @{org.allowedDomains.join(", @")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyOrg}
                    onClick={() => void handleJoinDomain(org.id)}
                    className="h-8 px-3 rounded-md text-[12px] border border-[#2b2b2b] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50 shrink-0"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
            {orgError && (
              <p className="text-[12px] text-[#f07070] mt-2">{orgError}</p>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-[#6e6e6e] text-[13px] py-16 text-center">
            Loading sessions…
          </div>
        ) : rooms.length === 0 ? (
          <div className="border border-dashed border-[#2b2b2b] rounded-lg py-16 text-center">
            <p className="text-[#a0a0a0] text-[14px] mb-1">No sessions yet</p>
            <p className="text-[#6e6e6e] text-[13px] mb-5">
              {activeOrg
                ? "Create a room for your team — every member will see it here."
                : "Create a room and invite teammates to watch and steer."}
            </p>
            <Link
              href={createHref}
              className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              Create session
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
