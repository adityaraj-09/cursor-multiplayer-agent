import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  maskPhoneE164,
  normalizePhoneE164,
  parseVoiceCallStatus,
  parseVoiceDecision,
} from "../shared/voiceApprovals.js";
import {
  generateVoiceToken,
  hashVoiceToken,
  voiceTokensEqual,
  secretsEqual,
} from "../server/sarvam.js";

describe("voice approval helpers", () => {
  it("normalizes Indian and E.164 phones", () => {
    expect(normalizePhoneE164("9876543210")).toBe("+919876543210");
    expect(normalizePhoneE164("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhoneE164("09876543210")).toBe("+919876543210");
    expect(normalizePhoneE164("+14155552671")).toBe("+14155552671");
    expect(normalizePhoneE164("not-a-phone")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
  });

  it("masks phones", () => {
    expect(maskPhoneE164("+919876543210")).toBe("+91••••3210");
  });

  it("parses spoken decisions", () => {
    expect(parseVoiceDecision("approve")).toBe("approved");
    expect(parseVoiceDecision("go ahead")).toBe("approved");
    expect(parseVoiceDecision("yes")).toBe("approved");
    expect(parseVoiceDecision(true)).toBe("approved");
    expect(parseVoiceDecision("deny")).toBe("denied");
    expect(parseVoiceDecision("stop")).toBe("denied");
    expect(parseVoiceDecision("no")).toBe("denied");
    expect(parseVoiceDecision("maybe")).toBeNull();
  });

  it("parses call statuses", () => {
    expect(parseVoiceCallStatus("no_answer")).toBe("no_answer");
    expect(parseVoiceCallStatus("busy")).toBe("busy");
    expect(parseVoiceCallStatus("nope")).toBeNull();
  });

  it("compares voice tokens in constant time", () => {
    const token = generateVoiceToken();
    const hash = hashVoiceToken(token);
    expect(voiceTokensEqual(token, hash)).toBe(true);
    expect(voiceTokensEqual("wrong", hash)).toBe(false);
    expect(voiceTokensEqual("", hash)).toBe(false);
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "xyz")).toBe(false);
  });
});

describe("voice approval persistence", () => {
  let db: typeof import("../server/db.js");

  beforeAll(async () => {
    db = await import("../server/db.js");
  });

  it("stores phone + opt-in on the user", () => {
    const id = `user_${randomUUID()}`;
    db.createUser(id, `${id}@example.com`, "Aditya");
    const updated = db.updateUserVoiceSettings(id, "+919876543210", true);
    expect(updated?.phone_e164).toBe("+919876543210");
    expect(updated?.voice_approvals_opt_in).toBe(1);
    const off = db.updateUserVoiceSettings(id, "+919876543210", false);
    expect(off?.voice_approvals_opt_in).toBe(0);
  });

  it("picks an opted-in owner who is not driving", async () => {
    const { pickVoiceApprovalCallee } = await import(
      "../server/voiceApprovalCall.js"
    );
    const ownerId = `owner_${randomUUID()}`;
    const editorId = `editor_${randomUUID()}`;
    db.createUser(ownerId, `${ownerId}@example.com`, "Owner");
    db.createUser(editorId, `${editorId}@example.com`, "Editor");
    db.updateUserVoiceSettings(ownerId, "+919111111111", true);
    db.updateUserVoiceSettings(editorId, "+919222222222", true);

    const room = db.createRoom({
      id: randomUUID(),
      name: "Voice Room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
    });
    db.setRoomOwner(room.id, ownerId);
    db.addRoomMember(room.id, editorId, "editor");

    const owner = pickVoiceApprovalCallee({
      roomId: room.id,
      ownerId,
      driverUserId: editorId,
    });
    expect(owner?.id).toBe(ownerId);

    const editor = pickVoiceApprovalCallee({
      roomId: room.id,
      ownerId,
      driverUserId: ownerId,
    });
    expect(editor?.id).toBe(editorId);
  });

  it("attaches a voice token hash to an approval", () => {
    const room = db.createRoom({
      id: randomUUID(),
      name: "Apr",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
    });
    const agent = db.createAgent({ roomId: room.id, label: "A" });
    const approval = db.createApprovalRequest({
      roomId: room.id,
      agentId: agent.id,
      callId: "c1",
      toolName: "shell",
      detail: "rm -rf dist",
    });
    const token = generateVoiceToken();
    db.setApprovalVoiceCall(approval.id, {
      tokenHash: hashVoiceToken(token),
      attemptId: "att_1",
      status: "dialing",
      calledUserId: "user_1",
    });
    const row = db.getApprovalRequest(approval.id);
    expect(row?.voice_call_attempt_id).toBe("att_1");
    expect(voiceTokensEqual(token, row?.voice_token_hash)).toBe(true);
    expect(db.getApprovalByVoiceAttempt("att_1")?.id).toBe(approval.id);
  });
});

describe("sarvam outbound payload", () => {
  const prev = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  });

  it("posts Instant Outbound with agent variables", async () => {
    process.env.SARVAM_API_KEY = "sk-test";
    process.env.SARVAM_ORG_ID = "org_1";
    process.env.SARVAM_WORKSPACE_ID = "ws_1";
    process.env.SARVAM_APP_ID = "steer-approval";
    process.env.SARVAM_APP_VERSION = "1";
    process.env.SARVAM_CONNECTION_ID = "conn_1";
    process.env.SARVAM_AGENT_PHONE = "+918000000000";
    process.env.API_PUBLIC_ORIGIN = "https://api.example.com";

    const { createInstantOutboundCall } = await import("../server/sarvam.js");
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ attempt_id: "att_99" }),
      } as Response;
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await createInstantOutboundCall({
        userPhone: "9876543210",
        initialBotMessage: "Hi",
        language: "English",
        variables: {
          approval_id: "apr_1",
          tool_name: "shell",
          voice_token: "tok",
        },
      });
      expect(result.attemptId).toBe("att_99");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/orgs/org_1/workspaces/ws_1/outbounds");
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
        "sk-test",
      );
      const body = JSON.parse(String(init.body)) as {
        user_config: { user_phone_number: string };
        app_config: { agent_variables: Record<string, string> };
      };
      expect(body.user_config.user_phone_number).toBe("+919876543210");
      expect(body.app_config.agent_variables.approval_id).toBe("apr_1");
    } finally {
      globalThis.fetch = original;
    }
  });
});
