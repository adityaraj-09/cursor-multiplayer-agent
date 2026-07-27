"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RoomCard from "../components/RoomCard";
import UserMenu from "../components/UserMenu";
import { useAuth } from "../components/AuthProvider";
import { fetchRooms } from "../lib/api";
import type { RoomInfo } from "../../shared/events";

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRooms([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchRooms()
      .then((r) => {
        if (!cancelled) setRooms(r);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = setInterval(() => {
      fetchRooms()
        .then((r) => {
          if (!cancelled) setRooms(r);
        })
        .catch(console.error);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, authLoading]);

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
            {!authLoading && user ? (
              <>
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
              </>
            ) : !authLoading ? (
              <Link
                href="/login"
                className="h-7 px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors flex items-center"
              >
                Sign in
              </Link>
            ) : null}
            <Link
              href="/create"
              className="h-8 px-2.5 sm:px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors flex items-center"
            >
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New session</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
            Sessions
          </h1>
          <p className="text-[13px] text-[#6e6e6e] mt-1">
            Multiplayer Cursor agent rooms
          </p>
        </div>

        {!authLoading && !user ? (
          <div className="border border-dashed border-[#2b2b2b] rounded-lg py-16 text-center">
            <p className="text-[#a0a0a0] text-[14px] mb-1">Sign in to continue</p>
            <p className="text-[#6e6e6e] text-[13px] mb-5">
              Your Steer sessions are private to your account.
            </p>
            <Link
              href="/login"
              className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              Sign in
            </Link>
          </div>
        ) : loading || authLoading ? (
          <div className="text-[#6e6e6e] text-[13px] py-16 text-center">
            Loading sessions…
          </div>
        ) : rooms.length === 0 ? (
          <div className="border border-dashed border-[#2b2b2b] rounded-lg py-16 text-center">
            <p className="text-[#a0a0a0] text-[14px] mb-1">No sessions yet</p>
            <p className="text-[#6e6e6e] text-[13px] mb-5">
              Create a room and invite teammates to watch and steer.
            </p>
            <Link
              href="/create"
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
