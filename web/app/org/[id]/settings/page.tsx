"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import UserMenu from "../../../../components/UserMenu";
import {
  clearOrgCursorKey,
  createOrgInvite,
  fetchOrg,
  fetchOrgInvites,
  fetchOrgMembers,
  removeOrgMember,
  revokeOrgInvite,
  setOrgCursorKey,
  updateOrg,
  updateOrgMemberRole,
  type OrgInfo,
  type OrgInviteInfo,
  type OrgMemberInfo,
  type OrgRole,
} from "../../../../lib/api";
import { canManageOrg } from "../../../../../shared/orgs";

export default function OrgSettingsPage() {
  const params = useParams<{ id: string }>();
  const orgId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user, loading: authLoading } = useAuth();

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMemberInfo[]>([]);
  const [invites, setInvites] = useState<OrgInviteInfo[]>([]);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [cursorKey, setCursorKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const [orgInfo, memberList] = await Promise.all([
      fetchOrg(orgId),
      fetchOrgMembers(orgId),
    ]);
    setOrg(orgInfo);
    setName(orgInfo.name);
    setDomains(orgInfo.allowedDomains.join(", "));
    setMembers(memberList);
    if (canManageOrg(orgInfo.role)) {
      setInvites(await fetchOrgInvites(orgId));
    } else {
      setInvites([]);
    }
  }, [orgId]);

  useEffect(() => {
    if (authLoading || !user || !orgId) return;
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load team");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, orgId, reload]);

  const isAdmin = canManageOrg(org?.role);

  const handleSaveGeneral = async () => {
    if (!orgId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateOrg(orgId, {
        name: name.trim(),
        allowedDomains: domains
          .split(/[,\s]+/)
          .map((d) => d.trim())
          .filter(Boolean),
      });
      setOrg(updated);
      setNotice("Team settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveKey = async () => {
    if (!orgId || !cursorKey.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await setOrgCursorKey(orgId, cursorKey.trim());
      setOrg((prev) =>
        prev
          ? {
              ...prev,
              cursorKeyConfigured: result.cursorKeyConfigured,
              cursorKeyHint: result.cursorKeyHint,
            }
          : prev,
      );
      setCursorKey("");
      setNotice("Shared Cursor key saved for the team");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  };

  const handleClearKey = async () => {
    if (!orgId) return;
    if (!window.confirm("Remove the team’s shared Cursor API key?")) return;
    setBusy(true);
    setError("");
    try {
      await clearOrgCursorKey(orgId);
      setOrg((prev) =>
        prev
          ? { ...prev, cursorKeyConfigured: false, cursorKeyHint: null }
          : prev,
      );
      setNotice("Shared Cursor key cleared");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!orgId) return;
    setBusy(true);
    setError("");
    try {
      const invite = await createOrgInvite(orgId, { role: "member" });
      setInvites((prev) => [invite, ...prev]);
      const url = `${window.location.origin}/org-invite/${invite.code}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setNotice("Invite link created and copied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <Link href="/login" className="text-[#4d9fff] text-[13px]">
          Sign in
        </Link>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#f07070] text-[14px] mb-3">{error || "Team not found"}</p>
          <Link href="/dashboard" className="text-[13px] text-[#4d9fff]">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414]">
      <header className="border-b border-[#2b2b2b]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="text-[13px] text-[#6e6e6e] hover:text-[#e4e4e4]"
            >
              ← Sessions
            </Link>
            <span className="text-[14px] font-medium text-[#e4e4e4] truncate">
              {org.name} settings
            </span>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {(error || notice) && (
          <p
            className={`text-[13px] ${error ? "text-[#f07070]" : "text-[#3ecf8e]"}`}
          >
            {error || notice}
          </p>
        )}

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 space-y-3">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">General</h2>
          <label className="block text-[11px] text-[#6e6e6e]">Team name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            className="w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-50"
          />
          <label className="block text-[11px] text-[#6e6e6e]">
            Allowed email domains (auto-join)
          </label>
          <input
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            disabled={!isAdmin}
            placeholder="acme.com, acme.io"
            className="w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-50"
          />
          <p className="text-[11px] text-[#6e6e6e]">
            Anyone with a matching email can join this team from the dashboard —
            separate from per-room invite links.
          </p>
          {isAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveGeneral()}
              className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
            >
              Save
            </button>
          )}
        </section>

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 space-y-3">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">
            Shared Cursor key
          </h2>
          <p className="text-[11px] text-[#6e6e6e]">
            One team key for cloud “Server key” sessions. Members don’t need to
            paste a key for every room.
          </p>
          {org.cursorKeyConfigured ? (
            <p className="text-[12px] text-[#a0a0a0]">
              Configured {org.cursorKeyHint}
            </p>
          ) : (
            <p className="text-[12px] text-[#f07070]">No shared key set</p>
          )}
          {isAdmin && (
            <>
              <input
                type="password"
                value={cursorKey}
                onChange={(e) => setCursorKey(e.target.value)}
                placeholder={
                  org.cursorKeyConfigured ? "Replace key…" : "cursor_…"
                }
                className="w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] font-mono outline-none focus:border-[#4d9fff]"
                autoComplete="off"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !cursorKey.trim()}
                  onClick={() => void handleSaveKey()}
                  className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
                >
                  Save key
                </button>
                {org.cursorKeyConfigured && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleClearKey()}
                    className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-medium text-[#e4e4e4]">
              Team invites
            </h2>
            {isAdmin && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateInvite()}
                className="h-8 px-3 rounded-md text-[12px] border border-[#2b2b2b] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
              >
                Create invite link
              </button>
            )}
          </div>
          {invites.length === 0 ? (
            <p className="text-[12px] text-[#6e6e6e]">No active team invites</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((invite) => {
                const url =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/org-invite/${invite.code}`
                    : `/org-invite/${invite.code}`;
                return (
                  <li
                    key={invite.code}
                    className="flex items-center justify-between gap-2 text-[12px]"
                  >
                    <code className="text-[#a0a0a0] truncate">{url}</code>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(url)
                        }
                        className="text-[#4d9fff] hover:underline"
                      >
                        Copy
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            void revokeOrgInvite(org.id, invite.code).then(
                              () =>
                                setInvites((prev) =>
                                  prev.filter((i) => i.code !== invite.code),
                                ),
                            )
                          }
                          className="text-[#f07070] hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 space-y-3">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">
            Members ({members.length})
          </h2>
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] text-[#e4e4e4] truncate">{m.name}</p>
                  <p className="text-[11px] text-[#6e6e6e] truncate">{m.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void updateOrgMemberRole(
                          org.id,
                          m.userId,
                          e.target.value as OrgRole,
                        ).then(() => reload())
                      }
                      className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4]"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="text-[11px] text-[#6e6e6e] capitalize">
                      {m.role}
                    </span>
                  )}
                  {isAdmin && m.role !== "owner" && m.userId !== user.id && (
                    <button
                      type="button"
                      onClick={() =>
                        void removeOrgMember(org.id, m.userId).then(() =>
                          reload(),
                        )
                      }
                      className="text-[11px] text-[#f07070] hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
