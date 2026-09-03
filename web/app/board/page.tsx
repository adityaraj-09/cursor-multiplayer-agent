"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { useAuth } from "../../components/AuthProvider";
import UserMenu from "../../components/UserMenu";
import BoardRoomSlot from "../../components/board/BoardRoomSlot";
import BoardAddTile from "../../components/board/BoardAddTile";
import { fetchRooms } from "../../lib/api";
import {
  MAX_BOARD_ROOMS,
  readBoardFocusRoomId,
  readBoardRoomIds,
  writeBoardFocusRoomId,
  writeBoardRoomIds,
} from "../../lib/boardStorage";
import { readSelectedWorkspace } from "../../lib/workspace";
import type { RoomInfo } from "../../../shared/events";

export default function BoardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<RoomInfo[]>([]);

  const userName =
    (typeof window !== "undefined" &&
      localStorage.getItem("agent-session-name")) ||
    user?.name ||
    "Guest";

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?redirect=/board");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !localStorage.getItem("agent-session-name")
    ) {
      localStorage.setItem("agent-session-name", user.name || "Guest");
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("rooms") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const stored = readBoardRoomIds();
    const next = Array.from(new Set([...fromQuery, ...stored])).slice(
      0,
      MAX_BOARD_ROOMS,
    );
    writeBoardRoomIds(next);
    setRoomIds(next);
    const storedFocus = readBoardFocusRoomId();
    setFocusId(storedFocus && next.includes(storedFocus) ? storedFocus : null);
    if (fromQuery.length) {
      params.delete("rooms");
      const qs = params.toString();
      router.replace(qs ? `/board?${qs}` : "/board", { scroll: false });
    }
    setReady(true);
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!ready) return;
    writeBoardRoomIds(roomIds);
  }, [ready, roomIds]);

  useEffect(() => {
    if (!ready) return;
    writeBoardFocusRoomId(focusId);
  }, [ready, focusId]);

  useEffect(() => {
    if (!ready || !user) return;
    const orgId = readSelectedWorkspace();
    fetchRooms({ orgId: orgId === "personal" ? "personal" : orgId })
      .then(setCatalog)
      .catch(console.error);
  }, [ready, user]);

  useEffect(() => {
    if (!focusId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId]);

  const names = useMemo(() => {
    const map = new Map(catalog.map((room) => [room.id, room.name]));
    return map;
  }, [catalog]);

  const addRoom = (id: string) => {
    setRoomIds((prev) => {
      if (prev.includes(id) || prev.length >= MAX_BOARD_ROOMS) return prev;
      return [...prev, id];
    });
  };

  const removeRoom = (id: string) => {
    setRoomIds((prev) => prev.filter((item) => item !== id));
    setFocusId((cur) => (cur === id ? null : cur));
  };

  const gridClass = useMemo(() => {
    const count = roomIds.length + 1;
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 lg:grid-cols-2";
    return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  }, [roomIds.length]);

  if (authLoading || !user || !ready) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading board…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] max-h-[100dvh] flex flex-col bg-[#111111] text-[#e4e4e4] overflow-hidden">
      <header className="shrink-0 border-b border-[#2b2b2b] bg-[#171717] pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 h-12">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              href="/dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4]"
              aria-label="Back to dashboard"
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <h1 className="text-[14px] font-medium text-[#f0f0f0]">Board</h1>
            <span className="text-[11px] text-[#6e6e6e]">
              {roomIds.length} session{roomIds.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {focusId && (
              <button
                type="button"
                onClick={() => setFocusId(null)}
                className="h-8 px-2.5 rounded-md text-[12px] border border-[#2b2b2b] text-[#a0a0a0] hover:text-[#e4e4e4]"
              >
                Exit focus
              </button>
            )}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 p-2 sm:p-3 flex flex-col gap-2">
        {focusId && roomIds.length > 1 && (
          <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto">
            {roomIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFocusId(id)}
                className={`h-8 px-2.5 rounded-md text-[11px] border shrink-0 ${
                  id === focusId
                    ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                    : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
                }`}
              >
                {names.get(id) || id.slice(0, 8)}
              </button>
            ))}
          </div>
        )}

        <div
          className={
            focusId
              ? "flex-1 min-h-0"
              : `flex-1 min-h-0 grid gap-2 ${gridClass}`
          }
        >
          {roomIds.map((id) => {
            const focused = focusId === id;
            const hidden = Boolean(focusId && !focused);
            return (
              <div
                key={id}
                className={
                  hidden
                    ? "hidden"
                    : focusId
                      ? "h-full min-h-0 rounded-lg overflow-hidden border border-[#2b2b2b]"
                      : "min-h-0 rounded-lg overflow-hidden border border-[#2b2b2b]"
                }
              >
                <BoardRoomSlot
                  roomId={id}
                  userName={userName}
                  focused={focused}
                  onFocus={() => setFocusId(focused ? null : id)}
                  onRemove={() => removeRoom(id)}
                />
              </div>
            );
          })}
          {!focusId && (
            <BoardAddTile
              pinnedIds={roomIds}
              disabled={roomIds.length >= MAX_BOARD_ROOMS}
              onAdd={addRoom}
            />
          )}
        </div>
      </main>
    </div>
  );
}
