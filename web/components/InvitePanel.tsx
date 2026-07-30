"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createInviteLink,
  listInviteLinks,
  revokeInviteLink,
  type InviteLinkInfo,
} from "../lib/api";

function inviteUrl(code: string): string {
  if (typeof window === "undefined") return `/invite/${code}`;
  return `${window.location.origin}/invite/${code}`;
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function InvitePanel({
  roomId,
  open,
  onClose,
}: {
  roomId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [invites, setInvites] = useState<InviteLinkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listInviteLinks(roomId);
      setInvites(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCopy = async (code: string) => {
    const url = inviteUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      window.prompt("Copy this invite link:", url);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const parsed = maxUses.trim() ? Number(maxUses.trim()) : null;
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) {
        throw new Error("Max uses must be a positive number");
      }
      const created = await createInviteLink(roomId, parsed);
      setMaxUses("");
      await refresh();
      await handleCopy(created.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (code: string) => {
    if (!window.confirm("Revoke this invite link? It will stop working immediately.")) {
      return;
    }
    setRevoking(code);
    setError("");
    try {
      await revokeInviteLink(code);
      setInvites((prev) => prev.filter((i) => i.code !== code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invite");
    } finally {
      setRevoking(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 px-0 sm:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md bg-[#1a1a1a] border border-[#2b2b2b] sm:rounded-lg rounded-t-lg shadow-xl max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Invite management"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-[#2b2b2b] shrink-0">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">Invites</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-2 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-transparent hover:border-[#2b2b2b]"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 border-b border-[#2b2b2b] space-y-2 shrink-0">
          <p className="text-[12px] text-[#6e6e6e]">
            Create a link teammates can use to join this session.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Max uses (optional)"
              className="flex-1 h-9 px-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff]"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-40 shrink-0"
            >
              {creating ? "Creating…" : "New link"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {error && (
            <p className="mb-2 text-[12px] text-[#f07070]">{error}</p>
          )}
          {loading && invites.length === 0 ? (
            <p className="text-[12px] text-[#6e6e6e]">Loading…</p>
          ) : invites.length === 0 ? (
            <p className="text-[12px] text-[#6e6e6e]">
              No invite links yet. Create one to share this session.
            </p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const exhausted =
                  invite.maxUses !== null &&
                  invite.useCount >= invite.maxUses;
                return (
                  <li
                    key={invite.code}
                    className="rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-mono text-[#e4e4e4] truncate">
                          {invite.code}
                        </p>
                        <p className="text-[11px] text-[#6e6e6e] mt-0.5">
                          {formatWhen(invite.createdAt)}
                          {" · "}
                          {invite.maxUses === null
                            ? `${invite.useCount} uses`
                            : `${invite.useCount}/${invite.maxUses} uses`}
                          {exhausted ? " · expired" : ""}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleCopy(invite.code)}
                          disabled={exhausted}
                          className="h-7 px-2 rounded-md text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] disabled:opacity-40"
                        >
                          {copiedCode === invite.code ? "Copied" : "Copy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(invite.code)}
                          disabled={revoking === invite.code}
                          className="h-7 px-2 rounded-md text-[11px] text-[#f07070] hover:text-[#ff8a8a] border border-[#3c2b2b] disabled:opacity-40"
                        >
                          {revoking === invite.code ? "…" : "Revoke"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
