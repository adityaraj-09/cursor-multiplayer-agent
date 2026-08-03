import * as db from "./db.js";
import { canManageOrg, type OrgRole } from "../shared/orgs.js";

/** Host or org owner/admin can manage the room. */
export function userCanManageRoom(roomId: string, userId: string): boolean {
  const row = db.getRoom(roomId);
  if (!row) return false;
  if (row.owner_id === userId) return true;
  if (!row.org_id) return false;
  const member = db.getOrganizationMember(row.org_id, userId);
  return canManageOrg((member?.role as OrgRole) || null);
}
