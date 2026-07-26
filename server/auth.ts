import { createHash, randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Request, Response, NextFunction } from "express";
import * as db from "./db.js";

const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (CLI worker tokens)
const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function clerkSecret(): string | undefined {
  return process.env.CLERK_SECRET_KEY?.trim() || undefined;
}

export function clerkConfigured(): boolean {
  return Boolean(clerkSecret());
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function generateInviteCode(): string {
  return nanoid(12);
}

export function generatePairingCode(): string {
  // Short, human-typable: XXXX-XXXX
  const raw = randomBytes(4).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function sessionExpiresAt(): number {
  return Date.now() + SESSION_TTL_MS;
}

export function pairingExpiresAt(): number {
  return Date.now() + PAIRING_TTL_MS;
}

async function resolveClerkUser(token: string): Promise<AuthUser | null> {
  const secretKey = clerkSecret();
  if (!secretKey) return null;

try {
    const payload = await verifyToken(token, { secretKey });
    const clerkId = String(payload.sub || "");
    if (!clerkId) return null;

    // Prefer existing local row (avoids a Clerk API call on every request)
    const existing = db.getUserById(clerkId);
    if (existing) {
      return {
        id: existing.id,
        email: existing.email,
        name: existing.name,
      };
    }

    const clerk = createClerkClient({ secretKey });
    const clerkUser = await clerk.users.getUser(clerkId);
    const email =
      clerkUser.primaryEmailAddress?.emailAddress ||
      clerkUser.emailAddresses[0]?.emailAddress ||
      `${clerkId}@clerk.local`;
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      email.split("@")[0] ||
      "User";

    const user = db.upsertUser(clerkId, email.toLowerCase(), name);
    return { id: user.id, email: user.email, name: user.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[auth] Clerk token verify failed:", msg);
    return null;
  }
}

function resolveSessionUser(token: string): AuthUser | null {
  const session =
    db.getSession(hashSessionToken(token)) || db.getSession(token);
  if (!session || session.expires_at < Date.now()) return null;
  const user = db.getUserById(session.user_id);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Attaches req.user from Clerk JWT or CLI session token.
 * Does NOT reject — use requireAuth for protected routes.
 */
export function authMiddleware() {
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

    void (async () => {
      try {
        if (looksLikeJwt(token)) {
          const user = await resolveClerkUser(token);
          if (user) req.user = user;
        } else {
          const user = resolveSessionUser(token);
          if (user) req.user = user;
        }
      } catch (err) {
        console.warn("[auth] token resolve failed:", err);
      }
      next();
    })();
  };
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/** Hash session tokens at rest (store hash, look up by hash). */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
