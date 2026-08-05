import { describe, expect, it } from "vitest";
import {
  approvalActionKey,
  isDangerousShellCommand,
  isSensitivePath,
  isShellTool,
  parseApprovalMode,
  parseAgentMode,
  requiresApproval,
} from "../shared/approvals.js";
import { isEditTool } from "../shared/backends/cursor.js";
import {
  attributionPromptSuffix,
  buildAttributedCommitMessage,
  formatCoAuthoredBy,
  resolveAuthorEmail,
} from "../shared/attribution.js";
import { CursorAgentBackend, ClaudeCodeBackend } from "../shared/backends/index.js";

describe("approval helpers", () => {
  it("parses modes", () => {
    expect(parseApprovalMode("dangerous")).toBe("dangerous");
    expect(parseApprovalMode("nope")).toBe("off");
    expect(parseAgentMode("plan")).toBe("plan");
    expect(parseAgentMode(true)).toBe("plan");
  });

  it("detects dangerous shell and sensitive paths", () => {
    expect(isShellTool("shell")).toBe(true);
    expect(isShellTool("Bash")).toBe(true);
    expect(isDangerousShellCommand("rm -rf dist && migrate")).toBe(true);
    expect(isDangerousShellCommand("git push origin main")).toBe(true);
    expect(isDangerousShellCommand("ls -la")).toBe(false);
    expect(isSensitivePath(".env.production")).toBe(true);
    expect(isSensitivePath(".github/workflows/ci.yml")).toBe(true);
    expect(isSensitivePath("src/app.ts")).toBe(false);
  });

  it("gates only when approval mode requires it", () => {
    const editEnv = {
      mode: "dangerous" as const,
      toolName: "write",
      path: ".env",
      detail: ".env",
      isEditTool,
    };
    expect(requiresApproval(editEnv)).toBe(true);
    expect(requiresApproval({ ...editEnv, mode: "off" })).toBe(false);
    expect(
      requiresApproval({
        mode: "dangerous",
        toolName: "write",
        path: "src/a.ts",
        detail: "src/a.ts",
        isEditTool,
      }),
    ).toBe(false);
    expect(
      requiresApproval({
        mode: "all",
        toolName: "write",
        path: "src/a.ts",
        detail: "src/a.ts",
        isEditTool,
      }),
    ).toBe(true);
    expect(
      requiresApproval({
        mode: "dangerous",
        toolName: "shell",
        detail: "prisma migrate deploy",
        isEditTool,
      }),
    ).toBe(true);
  });

  it("builds stable action keys", () => {
    expect(approvalActionKey("shell", "rm -rf dist", undefined)).toContain(
      "shell",
    );
  });
});

describe("attribution helpers", () => {
  it("formats Co-authored-by trailers", () => {
    const trailer = formatCoAuthoredBy({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(trailer).toBe("Co-authored-by: Ada Lovelace <ada@example.com>");
    expect(
      buildAttributedCommitMessage("steer: fix login", {
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toContain(trailer);
    expect(resolveAuthorEmail({ name: "Ada" })).toContain(
      "@users.noreply.github.com",
    );
    expect(
      attributionPromptSuffix({ name: "Ada", email: "ada@example.com" }),
    ).toContain("Co-authored-by:");
  });
});

describe("plan mode CLI flags", () => {
  it("adds Cursor --mode plan", () => {
    const args = new CursorAgentBackend().buildArgs({
      prompt: "hi",
      modelId: "auto",
      mode: "plan",
    });
    expect(args).toContain("--mode");
    expect(args).toContain("plan");
  });

  it("uses Claude --permission-mode plan instead of skip-permissions", () => {
    const args = new ClaudeCodeBackend().buildArgs({
      prompt: "hi",
      modelId: "auto",
      mode: "plan",
    });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("keeps Claude skip-permissions in agent mode", () => {
    const args = new ClaudeCodeBackend().buildArgs({
      prompt: "hi",
      modelId: "auto",
      mode: "agent",
    });
    expect(args).toContain("--dangerously-skip-permissions");
  });
});
