"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers3 } from "lucide-react";
import { Layers3, LayoutGrid, LayoutList } from "lucide-react";
import RoomCard from "../../components/RoomCard";
import CreateTeamCard from "../../components/CreateTeamCard";
import DashboardShell from "../../components/DashboardShell";
import EmptyState from "../../components/EmptyState";
import SessionComposeModal from "../../components/sessions/SessionComposeModal";
import SessionsGroupedList, {
  roomInfoToRow,
} from "../../components/SessionsGroupedList";
import { useAuth } from "../../components/AuthProvider";
import {
  archiveRoom,
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
import {
  MAX_BOARD_ROOMS,
  readBoardRoomIds,
  removeBoardRoomId,
  writeBoardRoomIds,
} from "../../lib/boardStorage";
import {
  readDashboardSessionsView,
  writeDashboardSessionsView,
  type DashboardSessionsView,
} from "../../lib/dashboardView";

export default function SessionsDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        </div>
      }
    >
      <SessionsDashboardBody />
    </Suspense>
  );
}

function SessionsDashboardBody() {
  const router = useRouter();
  const search = useSearchParams();
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archiveError, setArchiveError] = useState("");
  const composeOpen = search.get("compose") === "1";
  const [viewMode, setViewMode] = useState<DashboardSessionsView>("list");

  useEffect(() => {
    const raw = search.get("notice");
    if (!raw) return;
    setNotice(raw);
    const params = new URLSearchParams(search.toString());
    params.delete("notice");
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [search, router]);

  useEffect(() => {
    const orgFromQuery = search.get("org");
    if (orgFromQuery && orgFromQuery !== "personal") {
      setScope(orgFromQuery);
      writeSelectedWorkspace(orgFromQuery);
    } else if (!orgFromQuery) {
      setScope(readSelectedWorkspace());
    }
    setSelectedIds(readBoardRoomIds());
  }, [search]);
    setViewMode(readDashboardSessionsView());
  }, []);

  const selectViewMode = (next: DashboardSessionsView) => {
    setViewMode(next);
    writeDashboardSessionsView(next);
  };

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    Promise.all([fetchOrgs(), fetchJoinableOrgs()])
      .then(([orgList, joinList]) => {
        if (cancelled) return;
        setOrgs(orgList);
        setJoinable(joinList);
        const current = readSelectedWorkspace();
        if (current !== "personal" && !orgList.some((o) => o.id === current)) {
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
      setOrgs((prev) =>
        [...prev, org].sort((a, b) => a.name.localeCompare(b.name)),
      );
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
      setOrgs((prev) =>
        [...prev, org].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setJoinable((prev) => prev.filter((j) => j.id !== orgId));
      selectScope(org.id);
      setNotice(`Joined team “${org.name}”`);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to join team");
    } finally {
      setBusyOrg(false);
    }
  };

  const handleArchiveRoom = async (id: string) => {
    setArchiveError("");
    try {
      await archiveRoom(id);
      setRooms((prev) => prev.filter((room) => room.id !== id));
      setSelectedIds(removeBoardRoomId(id));
      setNotice("Session archived");
    } catch (err) {
      setArchiveError(
        err instanceof Error ? err.message : "Failed to archive session",
      );
    }
  };

  const activeOrg = orgs.find((o) => o.id === scope) || null;
  const createHref =
    scope === "personal"
      ? "/dashboard?compose=1"
      : `/dashboard?compose=1&org=${encodeURIComponent(scope)}`;
  const liveCount = useMemo(
    () => rooms.filter((room) => room.status === "active").length,
    [rooms],
  );
  const sessionRows = useMemo(() => rooms.map(roomInfoToRow), [rooms]);

  const toggleBoardSelect = (id: string) => {
    setSelectedIds((prev) => {
      const has = prev.includes(id);
      const next = has
        ? prev.filter((item) => item !== id)
        : prev.length >= MAX_BOARD_ROOMS
          ? prev
          : [...prev, id];
      writeBoardRoomIds(next);
      return next;
    });
  };

  const setCompose = (open: boolean) => {
    const params = new URLSearchParams(search.toString());
    if (open) params.set("compose", "1");
    else params.delete("compose");
    if (scope !== "personal") params.set("org", scope);
    else params.delete("org");
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  };

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
    <DashboardShell
      orgs={orgs}
      scope={scope}
      onSelectScope={selectScope}
      onNewTeam={() => {
        setCreatingOrg((v) => !v);
        setOrgError("");
      }}
      creatingTeam={creatingOrg}
      createHref={createHref}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        {notice && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] px-3.5 py-3">
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
        {archiveError && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-[#3c2b2b] bg-[#1a1414] px-3.5 py-3">
            <p className="flex-1 text-[13px] text-[#f07070] leading-5">
              {archiveError}
            </p>
            <button
              type="button"
              onClick={() => setArchiveError("")}
              className="shrink-0 text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4] transition-colors"
              aria-label="Dismiss archive error"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
              {activeOrg ? activeOrg.name : "Personal"}
            </p>
            <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
              Sessions
            </h1>
            <p className="text-[13px] text-[#6e6e6e] mt-1">
              {loading
                ? "Loading rooms…"
                : rooms.length === 0
                  ? activeOrg
                    ? `No rooms in ${activeOrg.name} yet`
                    : "Your personal multiplayer agent rooms"
                  : `${rooms.length} session${rooms.length === 1 ? "" : "s"}${
                      liveCount
                        ? ` · ${liveCount} live`
                        : ""
                    }`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCompose(true)}
            className="hidden lg:inline-flex h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center self-start"
          >
            New session
          </button>
          <div className="flex items-center gap-2 self-start">
            <div
              className="inline-flex h-9 items-center rounded-md border border-[#2b2b2b] bg-[#1a1a1a] p-0.5"
              role="group"
              aria-label="Session view"
            >
              <button
                type="button"
                onClick={() => selectViewMode("list")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] transition-colors ${
                  viewMode === "list"
                    ? "bg-[#252525] text-[#e4e4e4]"
                    : "text-[#6e6e6e] hover:text-[#e4e4e4]"
                }`}
                aria-pressed={viewMode === "list"}
                title="List view"
              >
                <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
                List
              </button>
              <button
                type="button"
                onClick={() => selectViewMode("grid")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] transition-colors ${
                  viewMode === "grid"
                    ? "bg-[#252525] text-[#e4e4e4]"
                    : "text-[#6e6e6e] hover:text-[#e4e4e4]"
                }`}
                aria-pressed={viewMode === "grid"}
                title="Grid view"
              >
                <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
                Grid
              </button>
            </div>
            <Link
              href={createHref}
              className="hidden lg:inline-flex h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              New session
            </Link>
          </div>
        </div>

        {joinable.length > 0 && (
          <div className="mb-6 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4">
            <p className="text-[13px] text-[#e4e4e4] mb-1">
              Join your company team
            </p>
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
                    <p className="text-[13px] text-[#e4e4e4] truncate">
                      {org.name}
                    </p>
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
          viewMode === "list" ? (
            <div className="rounded-lg border border-[#2b2b2b] bg-[#171717] divide-y divide-[#1f1f1f]">
              {[0, 1, 2, 3, 4].map((key) => (
                <div key={key} className="h-9 animate-pulse bg-[#1a1a1a]" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-[148px] rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] animate-pulse"
                />
              ))}
            </div>
          )
        ) : rooms.length === 0 ? (
          <EmptyState
            icon={Layers3}
            title="No sessions yet"
            description={
              activeOrg
                ? "Create a room for your team — every member will see it here."
                : "Create a room and invite teammates to watch and steer."
            }
            action={
              <button
                type="button"
                onClick={() => setCompose(true)}
                className="inline-flex h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
              >
                Create session
              </button>
            }
          />
        ) : (
          <>
            {viewMode === "list" ? (
              <div className="overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#141414]">
                <SessionsGroupedList
                  items={sessionRows}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleBoardSelect}
                  onArchive={handleArchiveRoom}
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    selectable
                    selected={selectedIds.includes(room.id)}
                    onArchive={handleArchiveRoom}
                    onToggleSelect={toggleBoardSelect}
                  />
                ))}
              </div>
            )}
            {selectedIds.length > 0 && (
              <div className="sticky bottom-4 mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#26405d] bg-[#17202a] px-3 py-2.5">
                <p className="text-[12px] text-[#8ec5ff]">
                  {selectedIds.length} selected for the board
                  {selectedIds.length >= MAX_BOARD_ROOMS ? " (max)" : ""}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIds([]);
                      writeBoardRoomIds([]);
                    }}
                    className="h-8 px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
                  >
                    Clear
                  </button>
                  <Link
                    href="/board"
                    className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white inline-flex items-center"
                  >
                    Open board
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      {creatingOrg && (
        <CreateTeamCard
          name={newOrgName}
          onNameChange={setNewOrgName}
          onCreate={() => void handleCreateOrg()}
          onCancel={() => {
            setCreatingOrg(false);
            setOrgError("");
          }}
          busy={busyOrg}
          error={orgError}
        />
      )}

      {composeOpen && (
        <SessionComposeModal
          initialOrgId={scope === "personal" ? undefined : scope}
          workspaceName={activeOrg?.name || "Personal"}
          onClose={() => setCompose(false)}
        />
      )}
    </DashboardShell>
  );
}
