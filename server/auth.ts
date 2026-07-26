import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";
import { AUTH_SECRET } from "./config.js";

const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function generateInviteCode(): string {
  return nanoid(12);
}

export function sessionExpiresAt(): number {
  return Date.now() + SESSION_TTL_MS;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Middleware: extracts Bearer token, looks up session + user.
 * Attaches req.user if valid. Does NOT reject — downstream can check req.user.
 */
export function authMiddleware(
  getSession: (token: string) => { user_id: string; expires_at: number } | undefined,
  getUserById: (id: string) => { id: string; email: string; name: string } | undefined,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      next();
      return;
    }
    const token = header.slice(7).trim();
    if (!token) {
      next();
      return;
    }
    const session = getSession(token);
    if (!session || session.expires_at < Date.now()) {
      next();
      return;
    }
    const user = getUserById(session.user_id);
    if (user) {
      req.user = { id: user.id, email: user.email, name: user.name };
    }
    next();
  };
}

/** Middleware: rejects if not authenticated. Use after authMiddleware. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/** Sign a simple HMAC for worker tokens (not JWT, just token lookup). */
export function signWorkerToken(workerId: string, userId: string): string {
  const payload = `${workerId}:${userId}:${Date.now()}`;
  const sig = createHash("sha256")
    .update(AUTH_SECRET + payload)
    .digest("hex")
    .slice(0, 16);
  return `${payload}:${sig}`;
}
