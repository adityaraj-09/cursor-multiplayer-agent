import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  SANDBOX_USER,
  buildCliBootstrapCommand,
  ensureSandboxUserScript,
  wrapSandboxCliCommand,
} from "../server/cliSandbox.js";

function assertValidSh(script: string): void {
  execFileSync("sh", ["-n", "-c", script], { encoding: "utf8" });
}

describe("Blaxel CLI sandbox user", () => {
  it("creates a non-root steer user without if/then", () => {
    const script = ensureSandboxUserScript();
    expect(script).toContain(`id -u ${SANDBOX_USER}`);
    expect(script).toContain("adduser");
    expect(script).toContain(`chown -R ${SANDBOX_USER}`);
    expect(script).not.toMatch(/\bthen\b/);
    expect(script).not.toMatch(/\bfi\b/);
    assertValidSh(script);
  });

  it("inlines IS_SANDBOX without su so stdout can stream", () => {
    const cmd = wrapSandboxCliCommand("claude -p hi", {
      IS_SANDBOX: "1",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
    expect(cmd).toContain("IS_SANDBOX=1");
    expect(cmd).toContain("ANTHROPIC_API_KEY=");
    expect(cmd).toContain("claude -p hi");
    expect(cmd).not.toContain(" su ");
    expect(cmd).not.toMatch(/\bthen\b/);
    assertValidSh(cmd);
  });

  it("bootstraps Claude with valid POSIX sh", () => {
    const cmd = buildCliBootstrapCommand("claude", "@anthropic-ai/claude-code");
    expect(cmd).toContain("npm i -g");
    expect(cmd).toContain("echo READY");
    expect(cmd).not.toMatch(/\bthen\b/);
    assertValidSh(cmd);
  });
});
