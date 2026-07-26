import * as pty from "node-pty";
import { SCROLLBACK_LIMIT } from "./config.js";
import { TMUX_PATH } from "./tmuxSession.js";
import {
  isTerminalAutoReply,
  sanitizeTerminalOutput,
} from "../shared/terminalFilter.js";

export class PtyRunner {
  private ptyProcess: pty.IPty | null = null;
  private scrollback = "";
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  constructor(
    private roomId: string,
    private cols = 200,
    private rows = 50,
  ) {}

  attach(): void {
    if (this.ptyProcess) return;

    this.ptyProcess = pty.spawn(TMUX_PATH, ["attach-session", "-t", this.roomId], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      const cleaned = sanitizeTerminalOutput(data);
      if (!cleaned) return;
      this.appendScrollback(cleaned);
      for (const cb of this.dataListeners) cb(cleaned);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.ptyProcess = null;
      for (const cb of this.exitListeners) cb(exitCode);
    });
  }

  write(data: string): void {
    if (isTerminalAutoReply(data)) return;
    this.ptyProcess?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    try {
      this.ptyProcess?.resize(cols, rows);
    } catch {
      // resize may fail if process already exited
    }
  }

  onData(cb: (data: string) => void): () => void {
    this.dataListeners.push(cb);
    return () => {
      this.dataListeners = this.dataListeners.filter((l) => l !== cb);
    };
  }

  onExit(cb: (code: number) => void): () => void {
    this.exitListeners.push(cb);
    return () => {
      this.exitListeners = this.exitListeners.filter((l) => l !== cb);
    };
  }

  getScrollback(): string {
    return this.scrollback;
  }

  isAlive(): boolean {
    return this.ptyProcess !== null;
  }

  destroy(): void {
    try {
      this.ptyProcess?.kill();
    } catch {
      // already dead
    }
    this.ptyProcess = null;
  }

  private appendScrollback(data: string): void {
    this.scrollback += data;
    if (this.scrollback.length > SCROLLBACK_LIMIT) {
      this.scrollback = this.scrollback.slice(-SCROLLBACK_LIMIT);
    }
  }
}
