import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import {
  generateToken,
  hashSessionToken,
  resetAuthTokenCache,
  resolveAuthToken,
  sessionExpiresAt,
} from "../server/auth.js";
import * as db from "../server/db/sqlite.js";

describe("resolveAuthToken cache", () => {
  afterEach(() => {
    resetAuthTokenCache();
    vi.useRealTimers();
  });

  it("returns cached user for a few seconds without hitting the session store", async () => {
    const user = db.createUser(
      `user_${randomBytes(4).toString("hex")}`,
      `cache-${randomBytes(4).toString("hex")}@example.com`,
      "Cache User",
    );
    const token = generateToken();
    db.createSession(hashSessionToken(token), user.id, sessionExpiresAt());

    const first = await resolveAuthToken(token);
    expect(first).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
    });

    db.deleteSession(hashSessionToken(token));
    const cached = await resolveAuthToken(token);
    expect(cached).toEqual(first);

    resetAuthTokenCache();
    const missed = await resolveAuthToken(token);
    expect(missed).toBeNull();
  });

  it("expires cached tokens after the TTL", async () => {
    vi.useFakeTimers();
    const user = db.createUser(
      `user_${randomBytes(4).toString("hex")}`,
      `ttl-${randomBytes(4).toString("hex")}@example.com`,
      "TTL User",
    );
    const token = generateToken();
    db.createSession(hashSessionToken(token), user.id, sessionExpiresAt());

    expect(await resolveAuthToken(token)).toMatchObject({ id: user.id });
    db.deleteSession(hashSessionToken(token));
    expect(await resolveAuthToken(token)).toMatchObject({ id: user.id });

    vi.advanceTimersByTime(8_001);
    expect(await resolveAuthToken(token)).toBeNull();
  });

  it("treats empty tokens as anonymous", async () => {
    expect(await resolveAuthToken("")).toBeNull();
    expect(await resolveAuthToken("   ")).toBeNull();
    expect(await resolveAuthToken(null)).toBeNull();
  });
});
