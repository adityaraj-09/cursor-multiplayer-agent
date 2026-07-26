import { watch, type FSWatcher } from "chokidar";
import simpleGit from "simple-git";

export class DiffWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private listeners: Array<(patch: string) => void> = [];
  private lastPatch = "";
  private git;

  constructor(
    private repoPath: string,
    private debounceMs = 300,
  ) {
    this.git = simpleGit(repoPath);
  }

  async start(): Promise<void> {
    this.lastPatch = await this.computeDiff();

    this.watcher = watch(this.repoPath, {
      ignored: [
        /(^|[/\\])\./,
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.git/**",
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("all", () => this.scheduleDiff());
  }

  onDiff(cb: (patch: string) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  getLastPatch(): string {
    return this.lastPatch;
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    await this.watcher?.close();
    this.watcher = null;
  }

  private scheduleDiff(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.emitDiff(), this.debounceMs);
  }

  private async emitDiff(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const patch = await this.computeDiff();
      this.lastPatch = patch;
      for (const cb of this.listeners) cb(patch);
    } catch (err) {
      console.error("diff error:", err);
    } finally {
      this.running = false;
    }
  }

  private async computeDiff(): Promise<string> {
    try {
      return await this.git.diff();
    } catch {
      return "";
    }
  }
}
