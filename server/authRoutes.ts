import { Router, type Router as RouterType } from "express";
import { nanoid } from "nanoid";
import * as db from "./db.js";
import {
  generateToken,
  generateInviteCode,
  generatePairingCode,
  sessionExpiresAt,
  pairingExpiresAt,
  hashSessionToken,
  requireAuth,
  clerkConfigured,
} from "./auth.js";

const router: RouterType = Router();

/** GET /api/auth/me — current user (Clerk JWT or CLI session) */
router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: req.user,
    clerk: clerkConfigured(),
  });
});

/**
 * POST /api/auth/pairing/create — authenticated user creates a short CLI code.
 * Body: none. Returns { code, expiresAt }.
 */
router.post("/pairing/create", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const code = generatePairingCode();
  const expiresAt = pairingExpiresAt();
  db.createPairingCode(code, req.user.id, expiresAt);
  res.json({ code, expiresAt });
});

/**
 * POST /api/auth/pairing/claim — CLI exchanges pairing code for a long-lived token.
 * Body: { code }
 */
router.post("/pairing/claim", (req, res) => {
  try {
    const code = String(req.body?.code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    const row = db.getPairingCode(code);
    if (!row) {
      res.status(404).json({ error: "Invalid pairing code" });
      return;
    }
    if (row.used) {
      res.status(410).json({ error: "Pairing code already used" });
      return;
    }
    if (row.expires_at < Date.now()) {
      res.status(410).json({ error: "Pairing code expired" });
      return;
    }

    const user = db.getUserById(row.user_id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    db.usePairingCode(code);

    const token = generateToken();
    db.createSession(hashSessionToken(token), user.id, sessionExpiresAt());

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Pairing failed",
    });
  }
});

/** POST /api/auth/logout — invalidate CLI session token */
router.post("/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.split(".").length !== 3) {
      db.deleteSession(hashSessionToken(token));
    }
  }
  res.json({ ok: true });
});

/** POST /api/auth/worker-token — mint a CLI/worker session (Clerk-authenticated) */
router.post("/worker-token", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const workerId = String(req.body?.workerId || nanoid(10));
  const workerName = String(req.body?.name || "cli-worker");

  db.registerWorker(workerId, req.user.id, workerName);

  const token = generateToken();
  db.createSession(hashSessionToken(token), req.user.id, sessionExpiresAt());

  res.json({ workerId, token });
});

/** POST /api/auth/:id/invite — create invite link */
router.post("/:id/invite", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const roomId = String(req.params.id);
  const room = db.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  // Require owner/member to mint invites
  if (
    room.owner_id !== req.user.id &&
    !db.isRoomMember(roomId, req.user.id)
  ) {
    res.status(403).json({ error: "Not allowed to invite to this room" });
    return;
  }

  const maxUses =
    req.body?.maxUses === null || req.body?.maxUses === undefined
      ? null
      : Number(req.body.maxUses);
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
    res.status(400).json({ error: "maxUses must be a positive number or null" });
    return;
  }
  const code = generateInviteCode();
  db.createInviteLink(code, roomId, req.user.id, maxUses);

  res.json({ code, roomId, maxUses, useCount: 0 });
});

/** GET /api/auth/:id/invites — list invite links for a room */
router.get("/:id/invites", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const roomId = String(req.params.id);
  const room = db.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (
    room.owner_id !== req.user.id &&
    !db.isRoomMember(roomId, req.user.id)
  ) {
    res.status(403).json({ error: "Not allowed to view invites for this room" });
    return;
  }

  const invites = db.listInviteLinks(roomId).map((row) => ({
    code: row.code,
    roomId: row.room_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
  }));
  res.json({ invites });
});

/** DELETE /api/auth/invite/:code — revoke an invite link */
router.delete("/invite/:code", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const inviteCode = String(req.params.code);
  const invite = db.getInviteLink(inviteCode);
  if (!invite) {
    res.status(404).json({ error: "Invite link not found" });
    return;
  }
  const room = db.getRoom(invite.room_id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (
    room.owner_id !== req.user.id &&
    !db.isRoomMember(invite.room_id, req.user.id)
  ) {
    res.status(403).json({ error: "Not allowed to revoke this invite" });
    return;
  }

  db.deleteInviteLink(inviteCode);
  res.json({ ok: true });
});

/** POST /api/auth/invite/:code/join — join room via invite */
router.post("/invite/:code/join", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const inviteCode = String(req.params.code);
  const invite = db.getInviteLink(inviteCode);
  if (!invite) {
    res.status(404).json({ error: "Invalid invite link" });
    return;
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    res.status(410).json({ error: "Invite link has expired" });
    return;
  }

  db.useInviteLink(inviteCode);
  db.addRoomMember(invite.room_id, req.user.id, "member");

  res.json({ roomId: invite.room_id });
});

/** GET /api/auth/my — rooms for current user */
router.get("/my", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const rooms = db.listRoomsByUser(req.user.id);
  res.json(rooms);
});

export default router;
