"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoomMemberInfo } from "../../shared/events";
import RightOverlay from "./RightOverlay";
import {
  roomRoleLabel,
  type RoomInviteRole,
  type RoomRole,
} from "../../shared/roomPermissions";
import {
  fetchRoomMembers,
  removeRoomMember,
  updateRoomMemberRole,
} from "../lib/api";

interface MemberRosterProps {
  roomId: string;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  myUserId?: string;
  /** Live roster from socket; falls back to REST fetch. */
  liveMembers?: RoomMemberInfo[];
  onMembersChange?: (members: RoomMemberInfo[]) => void;
  agentLabels?: Record<string, string>;
}

function RoleBadge({ role }: { role: RoomRole }) {
  const tone =
    role === "owner"
      ? "border-[#4d9fff]/50 text-[#4d9fff] bg-[#4d9fff]/10"
      : role === "editor"
        ? "border-[#3ecf8e]/40 text-[#3ecf8e] bg-[#3ecf8e]/10"
        : "border-[#2b2b2b] text-[#a0a0a0] bg-[#252525]";
  return (
    <span
      className={`inline-flex h-6 items-center px-2 rounded text-[11px] border ${tone}`}
    >
      {roomRoleLabel(role)}
    </span>
  );
}

export default function MemberRoster({
  roomId,
  open,
  onClose,
  canManage,
  myUserId,
  liveMembers,
  onMembersChange,
  agentLabels = {},
}: MemberRosterProps) {
  const [members, setMembers] = useState<RoomMemberInfo[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const apply = useCallback(
    (next: RoomMemberInfo[]) => {
      setMembers(next);
      onMembersChange?.(next);
    },
    [onMembersChange],
  );

  useEffect(() => {
    if (!open) return;
    if (liveMembers) {
      setMembers(liveMembers);
      return;
    }
    let cancelled = false;
    fetchRoomMembers(roomId)
      .then((list) => {
        if (!cancelled) apply(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load members");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, roomId, liveMembers, apply]);

  useEffect(() => {
    if (liveMembers) setMembers(liveMembers);
  }, [liveMembers]);

  if (!open) return null;

  const handleRole = async (userId: string, role: RoomInviteRole) => {
    setBusyId(userId);
    setError("");
    try {
      const next = await updateRoomMemberRole(roomId, userId, role);
      apply(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this session?`)) return;
    setBusyId(userId);
    setError("");
    try {
      await removeRoomMember(roomId, userId);
      apply(members.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <RightOverlay
      title="Members"
      subtitle="Roles, presence, and who’s driving"
      onClose={onClose}
    >
      {error && (
        <p className="px-4 pt-3 text-[12px] text-[#f07070]">{error}</p>
      )}

      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {members.map((m) => {
            const driving =
              m.drivingAgentIds
                ?.map((id) => agentLabels[id] || id.slice(0, 6))
                .join(", ") || "";
            const isMe = m.userId === myUserId;
            const canEdit = canManage && m.role !== "owner" && !isMe;
            return (
              <li
                key={m.userId}
                className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          m.online ? "bg-[#3ecf8e]" : "bg-[#3c3c3c]"
                        }`}
                        title={m.online ? "Online" : "Offline"}
                      />
                      <p className="text-[13px] text-[#e4e4e4] truncate">
                        {m.name}
                        {isMe ? " (you)" : ""}
                      </p>
                      <RoleBadge role={m.role} />
                    </div>
                    <p className="text-[11px] text-[#6e6e6e] truncate mt-0.5">
                      {m.email || "—"}
                    </p>
                    <p className="text-[11px] text-[#a0a0a0] mt-1">
                      {driving
                        ? `Driving ${driving}`
                        : m.online
                          ? "Online"
                          : "Offline"}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <select
                        value={m.role === "viewer" ? "viewer" : "editor"}
                        disabled={busyId === m.userId}
                        onChange={(e) =>
                          void handleRole(
                            m.userId,
                            e.target.value as RoomInviteRole,
                          )
                        }
                        className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        disabled={busyId === m.userId}
                        onClick={() => void handleRemove(m.userId, m.name)}
                        className="text-[11px] text-[#f07070] hover:underline disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="text-[12px] text-[#6e6e6e] py-6 text-center">
              No members yet
            </li>
          )}
        </ul>
    </RightOverlay>
  );
}
