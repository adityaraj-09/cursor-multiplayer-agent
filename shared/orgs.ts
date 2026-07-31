export type OrgRole = "owner" | "admin" | "member";

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  /** Comma-separated email domains that may auto-join (e.g. "acme.com,acme.io"). */
  allowedDomains: string[];
  createdBy: string;
  createdAt: number;
  /** Current user's role in this org. */
  role: OrgRole;
  memberCount: number;
  /** Masked Cursor key hint when an org shared key is configured. */
  cursorKeyHint?: string | null;
  cursorKeyConfigured: boolean;
}

export interface OrgMemberInfo {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  createdAt: number;
}

export interface OrgInviteInfo {
  code: string;
  orgId: string;
  createdBy: string;
  role: OrgRole;
  createdAt: number;
  maxUses: number | null;
  useCount: number;
  expiresAt: number | null;
}

export function normalizeEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

export function parseAllowedDomains(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function formatAllowedDomains(domains: string[]): string {
  return domains
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean)
    .join(",");
}

export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function slugifyOrgName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "team";
}
