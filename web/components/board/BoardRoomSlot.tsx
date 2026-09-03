"use client";

import { useEffect, useState } from "react";
import { fetchOrJoinRoom } from "../../lib/api";
import RoomProvider from "../room/RoomProvider";
import RoomChatPane from "../room/RoomChatPane";
import RoomDrawers from "../room/RoomDrawers";
import type { RoomInfo } from "../../../shared/events";

export default function BoardRoomSlot({
  roomId,
  userName,
  focused,
  onFocus,
  onRemove,
}: {
  roomId: string;
  userName: string;
  focused: boolean;
  onFocus: () => void;
  onRemove: () => void;
}) {
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchOrJoinRoom(roomId)
      .then((info) => {
        if (!cancelled) setRoomInfo(info);
      })
      .catch(() => {
        if (!cancelled) setError("Can’t join this session");
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 bg-[#141414] border border-[#2b2b2b] rounded-lg px-4 text-center">
        <p className="text-[12px] text-[#f07070]">{error}</p>
        <button
          type="button"
          onClick={onRemove}
          className="h-7 px-2.5 rounded-md text-[11px] border border-[#2b2b2b] text-[#a0a0a0] hover:text-[#e4e4e4]"
        >
          Remove
        </button>
      </div>
    );
  }

  if (!roomInfo) {
    return (
      <div className="h-full flex items-center justify-center bg-[#141414] border border-[#2b2b2b] rounded-lg">
        <p className="text-[12px] text-[#6e6e6e]">Loading session…</p>
      </div>
    );
  }

  return (
    <RoomProvider
      roomId={roomId}
      userName={userName}
      roomInfo={roomInfo}
      onRoomInfo={setRoomInfo}
      variant={focused ? "focus" : "tile"}
      homeHref="/board"
      onHome={focused ? onFocus : undefined}
      onExpand={focused ? undefined : onFocus}
      onRemove={onRemove}
      onKicked={() => onRemove()}
    >
      <div className="h-full min-h-0 relative">
        <RoomChatPane />
        {focused && <RoomDrawers />}
      </div>
    </RoomProvider>
  );
}
