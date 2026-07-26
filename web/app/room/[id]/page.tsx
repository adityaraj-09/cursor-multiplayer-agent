"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSocket } from "../../../hooks/useSocket";
import { fetchRoom } from "../../../lib/api";
import Terminal from "../../../components/Terminal";
import SidePanel from "../../../components/SidePanel";
import PresenceBar from "../../../components/PresenceBar";
import SteerInput from "../../../components/SteerInput";
import DriverControls from "../../../components/DriverControls";
import type { RoomInfo } from "../../../../shared/events";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [roomError, setRoomError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("agent-session-name");
    if (saved) setNameInput(saved);

    fetchRoom(roomId)
      .then(setRoomInfo)
      .catch(() => setRoomError("Room not found"));
  }, [roomId]);

  const handleJoin = () => {
    const name = nameInput.trim();
    if (!name) return;
    localStorage.setItem("agent-session-name", name);
    setUserName(name);
  };

  if (roomError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <div className="text-center">
          <p className="text-[#a0a0a0] text-[14px] mb-3">{roomError}</p>
          <Link
            href="/"
            className="text-[13px] text-[#4d9fff] hover:underline"
          >
            ← Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  if (!userName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <div className="w-full max-w-sm px-6">
          <div className="mb-6 text-center">
            <div className="w-8 h-8 rounded-md bg-[#e4e4e4] flex items-center justify-center mx-auto mb-4">
              <span className="text-[#141414] text-[13px] font-semibold">S</span>
            </div>
            <h2 className="text-[18px] font-medium text-[#e4e4e4] mb-1">
              Join session
            </h2>
            <p className="text-[13px] text-[#6e6e6e]">
              {roomInfo?.name || "Loading…"}
            </p>
          </div>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Your name"
            maxLength={30}
            autoFocus
            className="w-full h-10 px-3 mb-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] transition-colors"
          />
          <button
            onClick={handleJoin}
            className="w-full h-9 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return <LiveRoom roomId={roomId} userName={userName} roomInfo={roomInfo} />;
}

function LiveRoom({
  roomId,
  userName,
  roomInfo,
}: {
  roomId: string;
  userName: string;
  roomInfo: RoomInfo | null;
}) {
  const {
    socket,
    connected,
    participants,
    amDriver,
    mySocketId,
    steerLog,
    pendingRequest,
    scrollback,
    lastDiff,
    sendSteer,
    sendPtyInput,
    requestDrive,
    releaseDrive,
    grantDrive,
    sendResize,
    sendScrollHistory,
  } = useSocket(roomId, userName);

  const [dismissedRequest, setDismissedRequest] = useState(false);

  const handleGrantDrive = useCallback(() => {
    const requester = participants.find((p) => p.name === pendingRequest);
    if (requester) {
      grantDrive(requester.socketId);
    }
    setDismissedRequest(false);
  }, [participants, pendingRequest, grantDrive]);

  const activePendingRequest =
    pendingRequest && !dismissedRequest ? pendingRequest : null;

  return (
    <div className="h-screen flex flex-col bg-[#141414]">
      <header className="flex items-center justify-between px-3 h-10 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
          >
            <div className="w-5 h-5 rounded-[4px] bg-[#e4e4e4] flex items-center justify-center">
              <span className="text-[#141414] text-[9px] font-semibold">S</span>
            </div>
          </Link>
          <span className="text-[#2b2b2b]">/</span>
          <span className="text-[13px] text-[#e4e4e4] truncate">
            {roomInfo?.name || roomId}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              connected ? "bg-[#3ecf8e]" : "bg-[#f07070]"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
        </div>

        <div className="flex items-center gap-3">
          <PresenceBar participants={participants} mySocketId={mySocketId} />
          <div className="w-px h-4 bg-[#2b2b2b]" />
          <span className="text-[11px] text-[#6e6e6e] hidden sm:inline">
            {amDriver ? "Driving" : "Viewing"}
          </span>
          <DriverControls
            amDriver={amDriver}
            pendingRequest={activePendingRequest}
            onRequestDrive={requestDrive}
            onReleaseDrive={releaseDrive}
            onGrantDrive={handleGrantDrive}
            onDismissRequest={() => setDismissedRequest(true)}
          />
        </div>
      </header>

      <main className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <div className="flex items-center px-3 h-8 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
            <span className="text-[11px] text-[#6e6e6e] uppercase tracking-wide">
              Agent
            </span>
          </div>
          <Terminal
            socket={socket}
            amDriver={amDriver}
            scrollback={scrollback}
            onInput={sendPtyInput}
            onResize={sendResize}
            onScrollHistory={sendScrollHistory}
          />
        </div>

        <SidePanel
          socket={socket}
          lastDiff={lastDiff}
          steerLog={steerLog}
        />
      </main>

      <footer className="border-t border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        <SteerInput onSend={sendSteer} />
      </footer>
    </div>
  );
}
