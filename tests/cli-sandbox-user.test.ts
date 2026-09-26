import { describe, expect, it } from "vitest";
import {
  SANDBOX_USER,
  ensureSandboxUserScript,
  wrapSandboxCliCommand,
} from "../server/cliSandbox.js";

describe("Blaxel CLI sandbox user", () => {
  it("creates a non-root steer user", () => {
    const script = ensureSandboxUserScript();
    expect(script).toContain(`id -u ${SANDBOX_USER}`);
    expect(script).toContain("adduser");
    expect(script).toContain(`chown -R ${SANDBOX_USER}`);
  });

  it("drops root via su and inlines IS_SANDBOX for Claude", () => {
    const cmd = wrapSandboxCliCommand("claude -p hi", {
      IS_SANDBOX: "1",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
    expect(cmd).toContain(`su -s /bin/sh ${SANDBOX_USER} -c`);
    expect(cmd).toContain("IS_SANDBOX=1");
    expect(cmd).toContain("ANTHROPIC_API_KEY=");
    expect(cmd).toContain("claude -p hi");
    expect(cmd).toContain('[ "$(id -u)" = "0" ]');
  });
});
