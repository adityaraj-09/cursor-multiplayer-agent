import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  maskPhoneE164,
  normalizePhoneE164,
  parseVoiceCallStatus,
  parseVoiceDecision,
} from "../shared/voiceApprovals.js";
import { parseSarvamAppVersion } from "../server/config.js";
import {
  generateVoiceToken,
  hashVoiceToken,
  voiceTokensEqual,
  secretsEqual,
  parseUnknownAgentVariableNames,
  sarvamErrorText,
  resetRejectedAgentVariableKeys,
} from "../server/sarvam.js";

describe("voice approval helpers", () => {
  it("parses Sarvam app versions from dashboard labels", () => {
    expect(parseSarvamAppVersion("4")).toBe(4);
    expect(parseSarvamAppVersion("v4")).toBe(4);
    expect(parseSarvamAppVersion("V4")).toBe(4);
    expect(parseSarvamAppVersion("  v4  ")).toBe(4);
    expect(parseSarvamAppVersion("")).toBe(1);
    expect(parseSarvamAppVersion("nope")).toBe(1);
  });

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

  it("matches a tokenless decision to the single in-flight call", async () => {
    const { resolveVoiceDecisionTarget } = await import(
      "../server/voiceApprovalCall.js"
    );
    const room = db.createRoom({
      id: randomUUID(),
      name: "Voice",
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
      callId: "c-voice",
      toolName: "shell",
    });
    db.setApprovalVoiceCall(approval.id, {
      tokenHash: hashVoiceToken("tok"),
      attemptId: "att_live",
      status: "dialing",
      calledUserId: "user_voice",
    });
    for (const row of db.listPendingVoiceCalledApprovals()) {
      if (row.id !== approval.id) db.expireApprovalRequest(row.id);
    }

    const byId = resolveVoiceDecisionTarget({
      approvalId: approval.id,
      token: "",
      allowTokenless: true,
    });
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.tokenless).toBe(true);

    const wrong = resolveVoiceDecisionTarget({
      approvalId: approval.id,
      token: "nope",
      allowTokenless: true,
    });
    expect(wrong.ok).toBe(false);

    const matched = resolveVoiceDecisionTarget({
      approvalId: "",
      token: "",
      allowTokenless: true,
    });
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.row.id).toBe(approval.id);
      expect(matched.tokenless).toBe(true);
    }
  });
});

describe("sarvam error parsing", () => {
  it("reads nested Instant Outbound 422 details", () => {
    const names = parseUnknownAgentVariableNames(
      "Agent variables '{'agent_label', 'approval_id', 'tool_detail', 'user_name', 'voice_token', 'file_path', 'room_name', 'join_url'}' not found",
    );
    expect(names?.sort()).toEqual(
      [
        "agent_label",
        "approval_id",
        "file_path",
        "join_url",
        "room_name",
        "tool_detail",
        "user_name",
        "voice_token",
      ].sort(),
    );
    expect(
      sarvamErrorText(
        {
          error: {
            message: "(422) Invalid Parameter",
            data: { details: "Agent variables '{'x'}' not found" },
          },
        },
        '{"error":{}}',
      ),
    ).toBe("Agent variables '{'x'}' not found");
  });
});

describe("sarvam outbound payload", () => {
  const prev = { ...process.env };

  afterEach(() => {
    resetRejectedAgentVariableKeys();
    delete process.env.SARVAM_AGENT_VARIABLES;
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  });

  function sarvamEnv() {
    process.env.SARVAM_API_KEY = "sk-test";
    process.env.SARVAM_ORG_ID = "org_1";
    process.env.SARVAM_WORKSPACE_ID = "ws_1";
    process.env.SARVAM_APP_ID = "steer-approval";
    process.env.SARVAM_APP_VERSION = "1";
    process.env.SARVAM_CONNECTION_ID = "conn_1";
    process.env.SARVAM_AGENT_PHONE = "+918000000000";
    process.env.API_PUBLIC_ORIGIN = "https://api.example.com";
  }

  it("posts Instant Outbound with agent variables", async () => {
    sarvamEnv();

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
        app_config: { agent_variables?: Record<string, string> };
      };
      expect(body.user_config.user_phone_number).toBe("+919876543210");
      expect(body.app_config.agent_variables?.approval_id).toBe("apr_1");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("retries Instant Outbound without undeclared agent variables", async () => {
    sarvamEnv();
    const { createInstantOutboundCall } = await import("../server/sarvam.js");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        app_config: { agent_variables?: Record<string, string> };
      };
      const extra = Object.keys(body.app_config.agent_variables || {});
      if (extra.length > 0) {
        const listed = extra.map((name) => `'${name}'`).join(", ");
        return {
          ok: false,
          status: 422,
          text: async () =>
            JSON.stringify({
              error: {
                message: "(422) Invalid Parameter",
                type: "invalid_parameter",
                code: 422,
                data: {
                  details: `Agent variables '{${listed}}' not found`,
                },
              },
            }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ attempt_id: "att_retry" }),
      } as Response;
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await createInstantOutboundCall({
        userPhone: "9876543210",
        initialBotMessage: "Hi",
        variables: {
          user_name: "Aditya",
          room_name: "Room",
          agent_label: "Cursor",
          tool_name: "shell",
          tool_detail: "ls",
          file_path: "",
          approval_id: "apr_41de80dfb80920d5",
          voice_token: "tok",
          join_url: "https://example.com/room/1",
        },
      });
      expect(result.attemptId).toBe("att_retry");
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      const retryBody = JSON.parse(
        String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body),
      ) as { app_config: { agent_variables?: unknown; initial_bot_message?: string } };
      expect(retryBody.app_config.agent_variables).toBeUndefined();
      expect(retryBody.app_config.initial_bot_message).toBe("Hi");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("omits agent variables not in SARVAM_AGENT_VARIABLES", async () => {
    sarvamEnv();
    process.env.SARVAM_AGENT_VARIABLES = "tool_name";
    const { createInstantOutboundCall } = await import("../server/sarvam.js");
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ attempt_id: "att_allow" }),
      } as Response;
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await createInstantOutboundCall({
        userPhone: "9876543210",
        variables: {
          tool_name: "shell",
          approval_id: "apr_1",
          voice_token: "tok",
        },
      });
      const body = JSON.parse(
        String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
      ) as { app_config: { agent_variables: Record<string, string> } };
      expect(body.app_config.agent_variables).toEqual({ tool_name: "shell" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
