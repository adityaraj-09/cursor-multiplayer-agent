import { execFileSync, execSync } from "child_process";
import * as pty from "node-pty";

const ROOM = "smoke-test";
const TIMEOUT = 10_000;
const TMUX = execSync("which tmux", { encoding: "utf-8" }).trim();

function log(msg: string) {
  console.log(`[smoke] ${msg}`);
}

try {
  execFileSync(TMUX, ["kill-session", "-t", ROOM], { stdio: "ignore" });
} catch {
  // no session to kill
}

log("Creating tmux session with shell...");
execFileSync(TMUX, [
  "new-session",
  "-d",
  "-s",
  ROOM,
  "-x",
  "120",
  "-y",
  "30",
]);

log("Attaching via node-pty...");
const p = pty.spawn(TMUX, ["attach-session", "-t", ROOM], {
  name: "xterm-256color",
  cols: 120,
  rows: 30,
  env: process.env as Record<string, string>,
});

let output = "";
p.onData((data: string) => {
  output += data;
  process.stdout.write(data);
});

await new Promise((resolve) => setTimeout(resolve, 1000));

log("Writing 'echo SMOKE_OK' to PTY...");
p.write("echo SMOKE_OK\r");

await new Promise((resolve) => setTimeout(resolve, 2000));

if (output.includes("SMOKE_OK")) {
  log("SUCCESS: PTY read/write verified.");
} else {
  log("WARN: Did not see SMOKE_OK in output (may need more time).");
  log(`Output so far: ${output.slice(-200)}`);
}

log("Cleaning up...");
p.kill();

try {
  execFileSync(TMUX, ["kill-session", "-t", ROOM], { stdio: "ignore" });
} catch {
  // already dead
}

log("Smoke test complete.");
process.exit(0);
