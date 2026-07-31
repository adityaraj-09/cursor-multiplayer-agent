"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../components/AuthProvider";
import UserMenu from "../../../../components/UserMenu";
import {
  clearOrgAnthropicKey,
  clearOrgCursorKey,
  createOrgInvite,
  fetchOrg,
  fetchOrgInvites,
  fetchOrgMembers,
  removeOrgMember,
  revokeOrgInvite,
  setOrgAnthropicKey,
  setOrgCursorKey,
  updateOrg,
  updateOrgMemberRole,
  type OrgInfo,
  type OrgInviteInfo,
  type OrgMemberInfo,
  type OrgRole,
} from "../../../../lib/api";
import {
  canManageOrg,
  orgRoleDescription,
  orgRoleLabel,
} from "../../../../../shared/orgs";

function RoleBadge({ role }: { role: OrgRole }) {
  const tone =
    role === "owner"
      ? "border-[#4d9fff]/50 text-[#4d9fff] bg-[#4d9fff]/10"
      : role === "admin"
        ? "border-[#3ecf8e]/40 text-[#3ecf8e] bg-[#3ecf8e]/10"
        : "border-[#2b2b2b] text-[#a0a0a0] bg-[#252525]";
  return (
    <span
      className={`inline-flex h-6 items-center px-2 rounded text-[11px] border ${tone}`}
    >
      {orgRoleLabel(role)}
    </span>
  );
}

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
  const [anthropicKey, setAnthropicKey] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
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
  const isOwner = org?.role === "owner";

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

  const handleSaveCursorKey = async () => {
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

  const handleClearCursorKey = async () => {
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

  const handleSaveAnthropicKey = async () => {
    if (!orgId || !anthropicKey.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await setOrgAnthropicKey(orgId, anthropicKey.trim());
      setOrg((prev) =>
        prev
          ? {
              ...prev,
              anthropicKeyConfigured: result.anthropicKeyConfigured,
              anthropicKeyHint: result.anthropicKeyHint,
            }
          : prev,
      );
      setAnthropicKey("");
      setNotice("Shared Anthropic key saved for the team");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  };

  const handleClearAnthropicKey = async () => {
    if (!orgId) return;
    if (!window.confirm("Remove the team’s shared Anthropic API key?")) return;
    setBusy(true);
    setError("");
    try {
      await clearOrgAnthropicKey(orgId);
      setOrg((prev) =>
        prev
          ? { ...prev, anthropicKeyConfigured: false, anthropicKeyHint: null }
          : prev,
      );
      setNotice("Shared Anthropic key cleared");
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
      const role = inviteRole === "admin" ? "admin" : "member";
      const invite = await createOrgInvite(orgId, { role });
      setInvites((prev) => [invite, ...prev]);
      const url = `${window.location.origin}/org-invite/${invite.code}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setNotice(
        `${orgRoleLabel(role)} invite link created and copied`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (userId: string, role: OrgRole) => {
    if (!org) return;
    setBusy(true);
    setError("");
    try {
      await updateOrgMemberRole(org.id, userId, role);
      await reload();
      setNotice(`Updated role to ${orgRoleLabel(role)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
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

  const keysReady =
    org.cursorKeyConfigured && org.anthropicKeyConfigured;

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-medium text-[#e4e4e4]">
                Shared API keys
              </h2>
              <p className="text-[11px] text-[#6e6e6e] mt-1">
                Configure both Cursor and Anthropic so team cloud sessions work
                for either backend without per-room BYOK.
              </p>
            </div>
            <span
              className={`shrink-0 text-[11px] px-2 py-1 rounded border ${
                keysReady
                  ? "border-[#3ecf8e]/40 text-[#3ecf8e]"
                  : "border-[#f07070]/40 text-[#f07070]"
              }`}
            >
              {keysReady ? "Both set" : "Incomplete"}
            </span>
          </div>

          <div className="rounded-md border border-[#2b2b2b] bg-[#141414] p-3 space-y-2">
            <h3 className="text-[13px] font-medium text-[#e4e4e4]">
              Shared Cursor key
            </h3>
            <p className="text-[11px] text-[#6e6e6e]">
              Used for team Cursor cloud sessions (“Team key”).
            </p>
            {org.cursorKeyConfigured ? (
              <p className="text-[12px] text-[#a0a0a0]">
                Configured {org.cursorKeyHint}
              </p>
            ) : (
              <p className="text-[12px] text-[#f07070]">No shared Cursor key</p>
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
                    onClick={() => void handleSaveCursorKey()}
                    className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
                  >
                    Save Cursor key
                  </button>
                  {org.cursorKeyConfigured && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleClearCursorKey()}
                      className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="rounded-md border border-[#2b2b2b] bg-[#141414] p-3 space-y-2">
            <h3 className="text-[13px] font-medium text-[#e4e4e4]">
              Shared Anthropic key
            </h3>
            <p className="text-[11px] text-[#6e6e6e]">
              Used for team Claude Code cloud sessions (E2B). Same idea as the
              Cursor key — set once for the whole team.
            </p>
            {org.anthropicKeyConfigured ? (
              <p className="text-[12px] text-[#a0a0a0]">
                Configured {org.anthropicKeyHint}
              </p>
            ) : (
              <p className="text-[12px] text-[#f07070]">
                No shared Anthropic key
              </p>
            )}
            {isAdmin && (
              <>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={
                    org.anthropicKeyConfigured ? "Replace key…" : "sk-ant-…"
                  }
                  className="w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] font-mono outline-none focus:border-[#4d9fff]"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || !anthropicKey.trim()}
                    onClick={() => void handleSaveAnthropicKey()}
                    className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
                  >
                    Save Anthropic key
                  </button>
                  {org.anthropicKeyConfigured && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleClearAnthropicKey()}
                      className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-medium text-[#e4e4e4]">
                Team invites
              </h2>
              <p className="text-[11px] text-[#6e6e6e] mt-1">
                Invite as Admin to add a co-lead, or Member for session access
                only.
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(
                      e.target.value === "admin" ? "admin" : "member",
                    )
                  }
                  className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4]"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCreateInvite()}
                  className="h-8 px-3 rounded-md text-[12px] border border-[#2b2b2b] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
                >
                  Create invite
                </button>
              </div>
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px]"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <RoleBadge role={invite.role === "admin" ? "admin" : "member"} />
                      <code className="text-[#a0a0a0] truncate">{url}</code>
                    </div>
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
          <div>
            <h2 className="text-[14px] font-medium text-[#e4e4e4]">
              Members ({members.length})
            </h2>
            <p className="text-[11px] text-[#6e6e6e] mt-1">
              Roles: <span className="text-[#a0a0a0]">Owner</span> (full
              control) · <span className="text-[#a0a0a0]">Admin</span> (keys,
              invites, roles) · <span className="text-[#a0a0a0]">Member</span>{" "}
              (sessions only). Promote someone to Admin for a co-lead without
              giving away ownership.
            </p>
          </div>
          <ul className="space-y-3">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-[13px] text-[#e4e4e4] truncate">
                      {m.name}
                      {m.userId === user.id ? " (you)" : ""}
                    </p>
                    <RoleBadge role={m.role} />
                  </div>
                  <p className="text-[11px] text-[#6e6e6e] truncate">
                    {m.email}
                  </p>
                  <p className="text-[10px] text-[#6e6e6e] mt-0.5">
                    {orgRoleDescription(m.role)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      disabled={busy || (!isOwner && m.role === "admin")}
                      onChange={(e) =>
                        void handleRoleChange(
                          m.userId,
                          e.target.value as OrgRole,
                        )
                      }
                      className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
                      title={
                        !isOwner && m.role === "admin"
                          ? "Only the owner can change another admin’s role"
                          : undefined
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : null}
                  {isAdmin && m.role !== "owner" && m.userId !== user.id && (
                    <button
                      type="button"
                      disabled={busy || (!isOwner && m.role === "admin")}
                      onClick={() =>
                        void removeOrgMember(org.id, m.userId).then(() =>
                          reload(),
                        )
                      }
                      className="text-[11px] text-[#f07070] hover:underline disabled:opacity-40"
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
