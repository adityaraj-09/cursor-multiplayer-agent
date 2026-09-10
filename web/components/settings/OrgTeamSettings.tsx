"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOrgInvite,
  deleteOrg,
  fetchOrg,
  fetchOrgInvites,
  fetchOrgMembers,
  removeOrgMember,
  revokeOrgInvite,
  transferOrgOwnership,
  updateOrg,
  updateOrgMemberRole,
  type OrgInfo,
  type OrgInviteInfo,
  type OrgMemberInfo,
  type OrgRole,
} from "../../lib/api";
import {
  canManageOrg,
  orgRoleDescription,
  orgRoleLabel,
} from "../../../shared/orgs";

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

export default function OrgTeamSettings({
  orgId,
  userId,
  onOrgChange,
}: {
  orgId: string;
  userId: string;
  onOrgChange?: (org: OrgInfo) => void;
}) {
  const router = useRouter();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMemberInfo[]>([]);
  const [invites, setInvites] = useState<OrgInviteInfo[]>([]);
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [transferUserId, setTransferUserId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const onOrgChangeRef = useRef(onOrgChange);
  onOrgChangeRef.current = onOrgChange;

  const reload = useCallback(async () => {
    const [orgInfo, memberList] = await Promise.all([
      fetchOrg(orgId),
      fetchOrgMembers(orgId),
    ]);
    setOrg(orgInfo);
    setName(orgInfo.name);
    setDomains(orgInfo.allowedDomains.join(", "));
    setMembers(memberList);
    onOrgChangeRef.current?.(orgInfo);
    if (canManageOrg(orgInfo.role)) {
      setInvites(await fetchOrgInvites(orgId));
    } else {
      setInvites([]);
    }
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    reload().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load team");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const isAdmin = canManageOrg(org?.role);
  const isOwner = org?.role === "owner";

  if (!org) {
    return error ? (
      <p className="text-[13px] text-[#f07070]">{error}</p>
    ) : (
      <p className="text-[13px] text-[#6e6e6e]">Loading team…</p>
    );
  }

  return (
    <div className="space-y-4">
      {(error || notice) && (
        <p className={`text-[13px] ${error ? "text-[#f07070]" : "text-[#3ecf8e]"}`}>
          {error || notice}
        </p>
      )}

      <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5 space-y-3">
        <h2 className="text-[15px] font-medium text-[#e4e4e4]">General</h2>
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
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              setNotice("");
              void updateOrg(orgId, {
                name: name.trim(),
                allowedDomains: domains
                  .split(/[,\s]+/)
                  .map((d) => d.trim())
                  .filter(Boolean),
              })
                .then((updated) => {
                  setOrg(updated);
                  onOrgChange?.(updated);
                  setNotice("Team settings saved");
                })
                .catch((err) => {
                  setError(err instanceof Error ? err.message : "Failed to save");
                })
                .finally(() => setBusy(false));
            }}
            className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
          >
            Save
          </button>
        )}
      </section>

      <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-medium text-[#e4e4e4]">Team invites</h2>
            <p className="text-[12px] text-[#6e6e6e] mt-1">
              Invite as Admin to add a co-lead, or Member for session access only.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value === "admin" ? "admin" : "member")
                }
                className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  const role = inviteRole === "admin" ? "admin" : "member";
                  void createOrgInvite(orgId, { role })
                    .then(async (invite) => {
                      setInvites((prev) => [invite, ...prev]);
                      const url = `${window.location.origin}/org-invite/${invite.code}`;
                      await navigator.clipboard.writeText(url).catch(() => undefined);
                      setNotice(`${orgRoleLabel(role)} invite link created and copied`);
                    })
                    .catch((err) => {
                      setError(
                        err instanceof Error ? err.message : "Failed to create invite",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
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
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/org-invite/${invite.code}`;
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
                      onClick={() => void navigator.clipboard.writeText(url)}
                      className="text-[#4d9fff] hover:underline"
                    >
                      Copy
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          void revokeOrgInvite(org.id, invite.code).then(() =>
                            setInvites((prev) =>
                              prev.filter((item) => item.code !== invite.code),
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

      <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5 space-y-3">
        <div>
          <h2 className="text-[15px] font-medium text-[#e4e4e4]">
            Members ({members.length})
          </h2>
          <p className="text-[12px] text-[#6e6e6e] mt-1">
            Roles: Owner · Admin · Member
          </p>
        </div>
        <ul className="space-y-3">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[13px] text-[#e4e4e4] truncate">
                    {member.name}
                    {member.userId === userId ? " (you)" : ""}
                  </p>
                  <RoleBadge role={member.role} />
                </div>
                <p className="text-[11px] text-[#6e6e6e] truncate">{member.email}</p>
                <p className="text-[10px] text-[#6e6e6e] mt-0.5">
                  {orgRoleDescription(member.role)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isAdmin && member.role !== "owner" ? (
                  <select
                    value={member.role}
                    disabled={busy || (!isOwner && member.role === "admin")}
                    onChange={(e) => {
                      setBusy(true);
                      setError("");
                      void updateOrgMemberRole(
                        org.id,
                        member.userId,
                        e.target.value as OrgRole,
                      )
                        .then(() => reload())
                        .catch((err) => {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Failed to update role",
                          );
                        })
                        .finally(() => setBusy(false));
                    }}
                    className="h-8 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : null}
                {isAdmin &&
                  member.role !== "owner" &&
                  member.userId !== userId && (
                    <button
                      type="button"
                      disabled={busy || (!isOwner && member.role === "admin")}
                      onClick={() =>
                        void removeOrgMember(org.id, member.userId).then(() =>
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

      {isOwner && (
        <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5 space-y-4">
          <div>
            <h2 className="text-[15px] font-medium text-[#e4e4e4]">
              Ownership &amp; danger zone
            </h2>
            <p className="text-[12px] text-[#6e6e6e] mt-1">
              Transfer ownership or permanently delete this team.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={transferUserId}
              onChange={(e) => setTransferUserId(e.target.value)}
              className="h-9 flex-1 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4]"
            >
              <option value="">Select a member…</option>
              {members
                .filter((member) => member.role !== "owner" && member.userId !== userId)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name} ({member.email})
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={busy || !transferUserId}
              onClick={() => {
                const target = members.find((m) => m.userId === transferUserId);
                if (
                  !window.confirm(
                    `Transfer ownership to ${target?.name || "this member"}? You will become an admin.`,
                  )
                ) {
                  return;
                }
                setBusy(true);
                setError("");
                void transferOrgOwnership(orgId, transferUserId)
                  .then((updated) => {
                    setOrg(updated);
                    onOrgChange?.(updated);
                    setTransferUserId("");
                    setNotice("Ownership transferred");
                    return reload();
                  })
                  .catch((err) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Failed to transfer ownership",
                    );
                  })
                  .finally(() => setBusy(false));
              }}
              className="h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
            >
              Transfer
            </button>
          </div>
          <div className="space-y-2 border-t border-[#2b2b2b] pt-4">
            <p className="text-[12px] text-[#f07070]">
              Type <span className="text-[#a0a0a0]">{org.name}</span> to delete.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={org.name}
                className="h-9 flex-1 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#f07070]"
              />
              <button
                type="button"
                disabled={busy || deleteConfirm !== org.name}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Delete this team permanently? This cannot be undone.",
                    )
                  ) {
                    return;
                  }
                  setBusy(true);
                  void deleteOrg(orgId, deleteConfirm)
                    .then(() => router.push("/dashboard"))
                    .catch((err) => {
                      setError(
                        err instanceof Error ? err.message : "Failed to delete team",
                      );
                      setBusy(false);
                    });
                }}
                className="h-9 px-3 rounded-md bg-[#2a1818] border border-[#5a3a3a] text-[12px] text-[#f07070] disabled:opacity-50"
              >
                Delete team
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
