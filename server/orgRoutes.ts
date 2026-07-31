import { Router, type Router as RouterType } from "express";
import { nanoid } from "nanoid";
import { generateInviteCode, requireAuth } from "./auth.js";
import { INVITE_TTL_MS } from "./config.js";
import { encryptionConfigured } from "./keyCrypto.js";
import * as db from "./db.js";
import {
  clearOrgCursorKey,
  orgCursorKeyConfigured,
  orgCursorKeyHint,
  setOrgCursorKey,
} from "./orgKeys.js";
import {
  canManageOrg,
  formatAllowedDomains,
  normalizeEmailDomain,
  parseAllowedDomains,
  slugifyOrgName,
  type OrgInfo,
  type OrgInviteInfo,
  type OrgMemberInfo,
  type OrgRole,
} from "../shared/orgs.js";

const router: RouterType = Router();

function toOrgInfo(
  row: db.OrganizationRow,
  role: OrgRole,
): OrgInfo {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    allowedDomains: parseAllowedDomains(row.allowed_domains),
    createdBy: row.created_by,
    createdAt: row.created_at,
    role,
    memberCount: db.countOrganizationMembers(row.id),
    cursorKeyConfigured: orgCursorKeyConfigured(row.id),
    cursorKeyHint: orgCursorKeyHint(row.id),
  };
}

function requireOrgMember(
  orgId: string,
  userId: string,
): db.OrganizationMemberRow {
  const member = db.getOrganizationMember(orgId, userId);
  if (!member) {
    throw Object.assign(new Error("Organization not found"), { status: 404 });
  }
  return member;
}

function requireOrgAdmin(orgId: string, userId: string): db.OrganizationMemberRow {
  const member = requireOrgMember(orgId, userId);
  if (!canManageOrg(member.role)) {
    throw Object.assign(new Error("Only org owners/admins can do that"), {
      status: 403,
    });
  }
  return member;
}

function uniqueSlug(name: string): string {
  const base = slugifyOrgName(name);
  for (let i = 0; i < 8; i++) {
    const slug = i === 0 ? base : `${base}-${nanoid(4).toLowerCase()}`;
    if (!db.getOrganizationBySlug(slug)) return slug;
  }
  return `${base}-${nanoid(8).toLowerCase()}`;
}

function sendErr(res: import("express").Response, err: unknown): void {
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status: number }).status) || 400
      : 400;
  res.status(status).json({
    error: err instanceof Error ? err.message : "Request failed",
  });
}

/** GET /api/orgs — list orgs for current user */
router.get("/", requireAuth, (req, res) => {
  const rows = db.listOrganizationsForUser(req.user!.id);
  res.json({
    orgs: rows.map((r) => toOrgInfo(r, r.member_role as OrgRole)),
  });
});

/** GET /api/orgs/joinable — orgs matching the user's email domain */
router.get("/joinable", requireAuth, (req, res) => {
  const domain = normalizeEmailDomain(req.user!.email);
  if (!domain) {
    res.json({ orgs: [] });
    return;
  }
  const mine = new Set(
    db.listOrganizationsForUser(req.user!.id).map((o) => o.id),
  );
  const orgs = db
    .listOrganizationsWithDomains()
    .filter((o) => {
      if (mine.has(o.id)) return false;
      return parseAllowedDomains(o.allowed_domains).includes(domain);
    })
    .map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      allowedDomains: parseAllowedDomains(o.allowed_domains),
    }));
  res.json({ orgs });
});

/** POST /api/orgs/invites/:code/join — join via org invite link */
router.post("/invites/:code/join", requireAuth, (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    const invite = db.getOrganizationInvite(code);
    if (!invite) {
      res.status(404).json({ error: "Invalid invite link" });
      return;
    }
    const org = db.getOrganization(invite.org_id);
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const existing = db.getOrganizationMember(invite.org_id, req.user!.id);
    if (existing) {
      res.json({ org: toOrgInfo(org, existing.role as OrgRole) });
      return;
    }
    if (
      invite.expires_at !== null &&
      invite.expires_at !== undefined &&
      invite.expires_at <= Date.now()
    ) {
      res.status(410).json({ error: "Invite link has expired" });
      return;
    }
    if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
      res.status(410).json({ error: "Invite link has expired" });
      return;
    }
    if (!db.useOrganizationInvite(code)) {
      res.status(410).json({ error: "Invite link has expired" });
      return;
    }
    const role: OrgRole = invite.role === "admin" ? "admin" : "member";
    db.addOrganizationMember(invite.org_id, req.user!.id, role);
    res.json({ org: toOrgInfo(org, role) });
  } catch (err) {
    sendErr(res, err);
  }
});

/** POST /api/orgs — create an organization */
router.post("/", requireAuth, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name || name.length > 80) {
      res.status(400).json({ error: "Organization name is required (max 80 chars)" });
      return;
    }
    const domains = parseAllowedDomains(
      Array.isArray(req.body?.allowedDomains)
        ? (req.body.allowedDomains as string[]).join(",")
        : String(req.body?.allowedDomains || ""),
    );
    const id = nanoid(12);
    const slug = uniqueSlug(name);
    const row = db.createOrganization({
      id,
      name,
      slug,
      allowedDomains: formatAllowedDomains(domains),
      createdBy: req.user!.id,
    });
    db.addOrganizationMember(id, req.user!.id, "owner");
    res.status(201).json({ org: toOrgInfo(row, "owner") });
  } catch (err) {
    sendErr(res, err);
  }
});

/** GET /api/orgs/:orgId */
router.get("/:orgId", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const org = db.getOrganization(orgId);
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const member = requireOrgMember(orgId, req.user!.id);
    res.json({ org: toOrgInfo(org, member.role as OrgRole) });
  } catch (err) {
    sendErr(res, err);
  }
});

/** PATCH /api/orgs/:orgId — update name / allowed domains */
router.patch("/:orgId", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const org = db.getOrganization(orgId);
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const member = requireOrgAdmin(orgId, req.user!.id);
    const name =
      req.body?.name !== undefined
        ? String(req.body.name).trim()
        : org.name;
    if (!name || name.length > 80) {
      res.status(400).json({ error: "Invalid organization name" });
      return;
    }
    let slug = org.slug;
    if (name !== org.name) {
      slug = uniqueSlug(name);
    }
    const domains =
      req.body?.allowedDomains !== undefined
        ? parseAllowedDomains(
            Array.isArray(req.body.allowedDomains)
              ? (req.body.allowedDomains as string[]).join(",")
              : String(req.body.allowedDomains || ""),
          )
        : parseAllowedDomains(org.allowed_domains);
    db.updateOrganization(orgId, {
      name,
      slug,
      allowedDomains: formatAllowedDomains(domains),
    });
    const updated = db.getOrganization(orgId)!;
    res.json({ org: toOrgInfo(updated, member.role as OrgRole) });
  } catch (err) {
    sendErr(res, err);
  }
});

/** POST /api/orgs/:orgId/join-by-domain */
router.post("/:orgId/join-by-domain", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const org = db.getOrganization(orgId);
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const existing = db.getOrganizationMember(orgId, req.user!.id);
    if (existing) {
      res.json({ org: toOrgInfo(org, existing.role as OrgRole) });
      return;
    }
    const domain = normalizeEmailDomain(req.user!.email);
    const allowed = parseAllowedDomains(org.allowed_domains);
    if (!domain || !allowed.includes(domain)) {
      res.status(403).json({
        error: `Your email domain (@${domain || "unknown"}) is not allowed to join this organization`,
      });
      return;
    }
    db.addOrganizationMember(orgId, req.user!.id, "member");
    res.json({ org: toOrgInfo(org, "member") });
  } catch (err) {
    sendErr(res, err);
  }
});

/** GET /api/orgs/:orgId/members */
router.get("/:orgId/members", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    requireOrgMember(orgId, req.user!.id);
    const members: OrgMemberInfo[] = db.listOrganizationMembers(orgId).map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role as OrgRole,
      createdAt: m.created_at,
    }));
    res.json({ members });
  } catch (err) {
    sendErr(res, err);
  }
});

/** PATCH /api/orgs/:orgId/members/:userId */
router.patch("/:orgId/members/:userId", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const targetUserId = String(req.params.userId);
    requireOrgAdmin(orgId, req.user!.id);
    const role = String(req.body?.role || "") as OrgRole;
    if (role !== "admin" && role !== "member") {
      res.status(400).json({ error: "role must be admin or member" });
      return;
    }
    const target = db.getOrganizationMember(orgId, targetUserId);
    if (!target) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (target.role === "owner") {
      res.status(400).json({ error: "Cannot change the org owner's role" });
      return;
    }
    db.updateOrganizationMemberRole(orgId, targetUserId, role);
    res.json({ ok: true });
  } catch (err) {
    sendErr(res, err);
  }
});

/** DELETE /api/orgs/:orgId/members/:userId */
router.delete("/:orgId/members/:userId", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const targetUserId = String(req.params.userId);
    const actor = requireOrgMember(orgId, req.user!.id);
    const isSelf = targetUserId === req.user!.id;
    if (!isSelf) requireOrgAdmin(orgId, req.user!.id);
    const target = db.getOrganizationMember(orgId, targetUserId);
    if (!target) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (target.role === "owner") {
      res.status(400).json({ error: "Cannot remove the org owner" });
      return;
    }
    if (isSelf && actor.role === "owner") {
      res.status(400).json({ error: "Org owner cannot leave; transfer ownership first" });
      return;
    }
    db.removeOrganizationMember(orgId, targetUserId);
    res.json({ ok: true });
  } catch (err) {
    sendErr(res, err);
  }
});

/** GET /api/orgs/:orgId/invites */
router.get("/:orgId/invites", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    requireOrgAdmin(orgId, req.user!.id);
    const invites: OrgInviteInfo[] = db.listOrganizationInvites(orgId).map((i) => ({
      code: i.code,
      orgId: i.org_id,
      createdBy: i.created_by,
      role: i.role as OrgRole,
      createdAt: i.created_at,
      maxUses: i.max_uses,
      useCount: i.use_count,
      expiresAt: i.expires_at,
    }));
    res.json({ invites });
  } catch (err) {
    sendErr(res, err);
  }
});

/** POST /api/orgs/:orgId/invites */
router.post("/:orgId/invites", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    requireOrgAdmin(orgId, req.user!.id);
    if (!db.getOrganization(orgId)) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const role =
      req.body?.role === "admin" ? ("admin" as const) : ("member" as const);
    const maxUses =
      req.body?.maxUses === null || req.body?.maxUses === undefined
        ? null
        : Number(req.body.maxUses);
    if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
      res.status(400).json({ error: "maxUses must be a positive number or null" });
      return;
    }
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const code = generateInviteCode();
    const invite = db.createOrganizationInvite({
      code,
      orgId,
      createdBy: req.user!.id,
      role,
      maxUses,
      expiresAt,
    });
    res.status(201).json({
      invite: {
        code: invite.code,
        orgId: invite.org_id,
        createdBy: invite.created_by,
        role: invite.role,
        createdAt: invite.created_at,
        maxUses: invite.max_uses,
        useCount: invite.use_count,
        expiresAt: invite.expires_at,
      } satisfies OrgInviteInfo,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

/** DELETE /api/orgs/:orgId/invites/:code */
router.delete("/:orgId/invites/:code", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    const code = String(req.params.code);
    requireOrgAdmin(orgId, req.user!.id);
    const invite = db.getOrganizationInvite(code);
    if (!invite || invite.org_id !== orgId) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    db.deleteOrganizationInvite(code);
    res.json({ ok: true });
  } catch (err) {
    sendErr(res, err);
  }
});

/** PUT /api/orgs/:orgId/cursor-key — set shared org Cursor key */
router.put("/:orgId/cursor-key", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    requireOrgAdmin(orgId, req.user!.id);
    if (!encryptionConfigured()) {
      res.status(400).json({
        error: "KEY_ENCRYPTION_SECRET is required to store an org key",
      });
      return;
    }
    const apiKey = String(req.body?.apiKey || "").trim();
    if (!apiKey) {
      res.status(400).json({ error: "apiKey is required" });
      return;
    }
    const { hint } = setOrgCursorKey(orgId, apiKey);
    res.json({ cursorKeyConfigured: true, cursorKeyHint: hint });
  } catch (err) {
    sendErr(res, err);
  }
});

/** DELETE /api/orgs/:orgId/cursor-key */
router.delete("/:orgId/cursor-key", requireAuth, (req, res) => {
  try {
    const orgId = String(req.params.orgId);
    requireOrgAdmin(orgId, req.user!.id);
    clearOrgCursorKey(orgId);
    res.json({ cursorKeyConfigured: false, cursorKeyHint: null });
  } catch (err) {
    sendErr(res, err);
  }
});

export default router;
