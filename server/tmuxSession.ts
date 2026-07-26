import { execFileSync, execSync } from "child_process";

const VALID_ROOM = /^[a-zA-Z0-9_-]+$/;

export const TMUX_PATH = execSync("which tmux", { encoding: "utf-8" }).trim();

function tmux(...args: string[]): string {
  return execFileSync(TMUX_PATH, args, {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

export function hasSession(roomId: string): boolean {
  try {
    execFileSync(TMUX_PATH, ["has-session", "-t", roomId], {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export function ensureSession(
  repoPath: string,
  roomId: string,
  agentCommand: string,
): void {
  if (!VALID_ROOM.test(roomId)) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }

  if (hasSession(roomId)) {
    console.log(`tmux session "${roomId}" already exists`);
    return;
  }

  const [cmd, ...args] = agentCommand.split(" ");

  execFileSync(
    TMUX_PATH,
    [
      "new-session",
      "-d",
      "-s",
      roomId,
      "-c",
      repoPath,
      "-x",
      "200",
      "-y",
      "50",
      cmd,
      ...args,
    ],
    { timeout: 10000 },
  );

  // Hide tmux chrome. Mouse ON so wheel scrolls tmux history (copy-mode) —
  // Cursor Agent does not handle SGR wheel itself (it pastes them as literals).
  try {
    execFileSync(TMUX_PATH, ["set-option", "-t", roomId, "status", "off"], {
      timeout: 3000,
    });
    execFileSync(
      TMUX_PATH,
      ["set-option", "-t", roomId, "set-titles", "off"],
      { timeout: 3000 },
    );
    execFileSync(TMUX_PATH, ["set-option", "-t", roomId, "mouse", "on"], {
      timeout: 3000,
    });
    execFileSync(
      TMUX_PATH,
      ["set-option", "-t", roomId, "history-limit", "50000"],
      { timeout: 3000 },
    );
  } catch {
    // non-fatal
  }

  console.log(
    `tmux session "${roomId}" started in ${repoPath} running "${agentCommand}"`,
  );
}

export function killSession(roomId: string): void {
  try {
    execFileSync(TMUX_PATH, ["kill-session", "-t", roomId], {
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    // session may already be dead
  }
}

export function exitCopyMode(roomId: string): void {
  if (!VALID_ROOM.test(roomId)) return;
  try {
    execFileSync(TMUX_PATH, ["send-keys", "-t", roomId, "-X", "cancel"], {
      timeout: 3000,
      stdio: "ignore",
    });
  } catch {
    // not in copy-mode
  }
}

/**
 * Scroll through tmux pane history (conversation transcript).
 * Anyone can do this — it does not type into the agent.
 */
export function scrollHistory(
  roomId: string,
  direction: "up" | "down",
  lines = 3,
): void {
  if (!VALID_ROOM.test(roomId)) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }
  const n = Math.min(40, Math.max(1, Math.round(lines)));

  try {
    execFileSync(TMUX_PATH, ["copy-mode", "-t", roomId], {
      timeout: 3000,
      stdio: "ignore",
    });
  } catch {
    // already in copy-mode or failed
  }

  const action = direction === "up" ? "scroll-up" : "scroll-down";
  try {
    execFileSync(
      TMUX_PATH,
      ["send-keys", "-t", roomId, "-X", "-N", String(n), action],
      { timeout: 3000, stdio: "ignore" },
    );
  } catch {
    // ignore
  }

  // Return to live view once the user scrolls back to the bottom
  if (direction === "down") {
    try {
      const pos = tmux(
        "display-message",
        "-p",
        "-t",
        roomId,
        "#{scroll_position}",
      );
      if (!pos || pos === "0") {
        exitCopyMode(roomId);
      }
    } catch {
      // ignore
    }
  }
}

export function sendKeys(roomId: string, text: string): void {
  if (!VALID_ROOM.test(roomId)) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }
  // Leave history scroll so keystrokes reach the agent
  exitCopyMode(roomId);
  // -l = literal text (don't interpret key names); then Enter to submit
  execFileSync(TMUX_PATH, ["send-keys", "-t", roomId, "-l", text], {
    timeout: 5000,
  });
  execFileSync(TMUX_PATH, ["send-keys", "-t", roomId, "Enter"], {
    timeout: 5000,
  });
}

export function listSessions(): string[] {
  try {
    const out = tmux("list-sessions", "-F", "#{session_name}");
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
