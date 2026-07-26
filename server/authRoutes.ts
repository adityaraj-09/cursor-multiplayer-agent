import { Router, type Router as RouterType } from "express";
import { nanoid } from "nanoid";
import * as db from "./db.js";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  generateInviteCode,
  sessionExpiresAt,
  requireAuth,
} from "./auth.js";

const router: RouterType = Router();

/** POST /api/auth/register — create account */
router.post("/register", (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !name || !password) {
      res.status(400).json({ error: "email, name, and password are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const id = nanoid(12);
    const passwordHash = hashPassword(password);
    db.createUser(id, email, name, passwordHash);

    const token = generateToken();
    db.createSession(token, id, sessionExpiresAt());

    res.status(201).json({
      user: { id, email, name },
      token,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Registration failed",
    });
  }
});

/** POST /api/auth/login — authenticate */
router.post("/login", (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = db.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = generateToken();
    db.createSession(token, user.id, sessionExpiresAt());

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Login failed",
    });
  }
});

/** POST /api/auth/logout — invalidate token */
router.post("/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    db.deleteSession(header.slice(7).trim());
  }
  res.json({ ok: true });
});

/** GET /api/auth/me — current user */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** POST /api/auth/worker-token — get a token for CLI worker */
router.post("/worker-token", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const workerId = String(req.body?.workerId || nanoid(10));
  const workerName = String(req.body?.name || "cli-worker");

  db.registerWorker(workerId, req.user.id, workerName);

  const token = generateToken();
  db.createSession(token, req.user.id, sessionExpiresAt());

  res.json({ workerId, token });
});

/** POST /api/rooms/:id/invite — create invite link */
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

  const maxUses = req.body?.maxUses ?? null;
  const code = generateInviteCode();
  db.createInviteLink(code, roomId, req.user.id, maxUses);

  res.json({ code, roomId });
});

/** POST /api/invite/:code/join — join room via invite */
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

/** GET /api/rooms/my — rooms owned by or joined by current user */
router.get("/my", requireAuth, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Auth required" });
    return;
  }
  const rooms = db.listRoomsByUser(req.user.id);
  res.json(rooms);
});

export default router;
