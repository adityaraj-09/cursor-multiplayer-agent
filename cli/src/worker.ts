import { io, type Socket } from "socket.io-client";
import { hostname } from "os";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { pickFolder } from "./pickFolder.js";
import { listLocalModels } from "./listModels.js";
import {
  runAgentWithHandle,
  abortRun,
  abortAll,
  isEditTool,
  getFileDiff,
  revertFiles,
  type AgentStreamEvent,
} from "./agent.js";
import { listChatSessions } from "./listSessions.js";
import {
  isSafeAttachmentRelPath,
  type WorkerPromptAttachment,
} from "../../shared/uploads.js";

const WORKER_PROTOCOL = 4;
const MAX_CONCURRENT = Number(process.env.STEER_MAX_CONCURRENT_AGENTS || 4);
const LOCK_WAIT_MS = 5000;
/** Match server attachFileDiff — wait for the working tree to flush. */
const DIFF_WAIT_MS = 120;

function writeWorkerAttachments(
  cwd: string,
  attachments: WorkerPromptAttachment[],
): void {
  const root = resolve(cwd);
  for (const file of attachments) {
    if (!file?.relPath || !isSafeAttachmentRelPath(file.relPath)) {
      throw new Error(`Invalid attachment path: ${file?.relPath || "(empty)"}`);
    }
    const abs = resolve(root, file.relPath);
    if (abs !== root && !abs.startsWith(root + "/") && !abs.startsWith(root + "\\")) {
      throw new Error(`Attachment escaped workspace: ${file.relPath}`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(file.data, "base64"));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LockResultPayload {
  requestId: string;
  granted: boolean;
  holderAgentId?: string;
}

function acquireFileLock(
  socket: Socket,
  roomId: string,
  agentId: string,
  path: string,
  callId: string,
): Promise<{ granted: boolean; holderAgentId?: string }> {
  const requestId = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}-${path}`)
    .digest("hex")
    .slice(0, 16);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("worker:lock-result", onResult);
      resolve({ granted: false });
    }, LOCK_WAIT_MS);

    const onResult = (data: LockResultPayload) => {
      if (data.requestId !== requestId) return;
      clearTimeout(timer);
      socket.off("worker:lock-result", onResult);
      resolve({
        granted: data.granted,
        holderAgentId: data.holderAgentId,
      });
    };

    socket.on("worker:lock-result", onResult);
    socket.emit("worker:acquire-lock", {
      requestId,
      roomId,
      agentId,
      path,
      callId,
    });
  });
}

interface RunPromptPayload {
  roomId: string;
  agentId?: string;
  prompt: string;
  repoPath: string;
  cwd?: string;
  modelId: string;
  sessionId?: string | null;
  /** `cursor` (default) or `claude-code` */
  backend?: string;
  /** Plan vs agent mode for this run. */
  mode?: "agent" | "plan";
  attachments?: WorkerPromptAttachment[];
}

interface AbortPayload {
  roomId: string;
  agentId?: string;
}

type QueuedEmit = { event: string; payload: unknown };

interface RunState {
  roomId: string;
  agentId: string;
  runSeq: number;
  editedPaths: Map<string, string>;
  pendingCallPaths: Map<string, string>;
  emittedTerminal: boolean;
  abort: () => void;
}

function generateWorkerId(email: string): string {
  const raw = `${hostname()}-${email}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function makeRunKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}

export function startWorker(repoPathOverride?: string): void {
  const config = loadConfig();
  if (!config) {
    console.error(chalk.red("Not logged in. Run `steer login` first."));
    process.exit(1);
  }

  const workerId = generateWorkerId(config.email);
  const serverUrl = config.serverUrl;

  console.log(chalk.blue("Connecting to"), serverUrl);
  console.log(chalk.gray(`Worker ID: ${workerId}`));
  console.log(chalk.gray(`Protocol: ${WORKER_PROTOCOL}`));

  const activeRuns = new Map<string, RunState>();
  let runSeqCounter = 0;
  const offlineQueue: QueuedEmit[] = [];
  const lastSessionByAgent = new Map<string, string>();
  const MAX_QUEUE = 500;

  const socket: Socket = io(`${serverUrl}/worker`, {
    auth: { token: config.token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    transports: ["websocket", "polling"],
  });

  const emitOrQueue = (event: string, payload: unknown): void => {
    if (socket.connected) {
      socket.emit(event, payload);
      return;
    }
    if (offlineQueue.length >= MAX_QUEUE) offlineQueue.shift();
    offlineQueue.push({ event, payload });
  };

  const flushQueue = (): void => {
    if (!offlineQueue.length) return;
    console.log(
      chalk.gray(`  Flushing ${offlineQueue.length} buffered event(s)…`),
    );
    const batch = offlineQueue.splice(0, offlineQueue.length);
    for (const item of batch) {
      socket.emit(item.event, item.payload);
    }
  };

  const listActiveRuns = () =>
    [...activeRuns.values()].map((r) => ({
      roomId: r.roomId,
      agentId: r.agentId,
    }));

  const announceReady = () => {
    const runs = listActiveRuns();
    socket.emit("worker:ready", {
      workerId,
      machineName: hostname(),
      protocol: WORKER_PROTOCOL,
      activeRuns: runs,
      // Legacy fields for older servers
      activeRoomId: runs[0]?.roomId ?? null,
      busy: runs.length > 0,
    });
  };

  socket.on("connect", () => {
    console.log(chalk.green("✓ Connected to server"));
    if (activeRuns.size > 0) {
      console.log(
        chalk.cyan(
          `  ${activeRuns.size} agent run(s) still going — resuming stream`,
        ),
      );
    }
    announceReady();
    flushQueue();
  });

  socket.on("disconnect", (reason) => {
    console.log(chalk.yellow(`Disconnected: ${reason}`));
    if (activeRuns.size > 0) {
      console.log(
        chalk.yellow(
          `  ${activeRuns.size} agent(s) keep running locally (will sync on reconnect)`,
        ),
      );
    }
  });

  socket.on("connect_error", (err) => {
    console.error(chalk.red(`Connection error: ${err.message}`));
  });

  socket.on("worker:run-prompt", (payload: RunPromptPayload) => {
    const {
      roomId,
      prompt,
      repoPath: payloadRepoPath,
      cwd: payloadCwd,
      modelId,
    } = payload;
    const agentId = payload.agentId || "default";
    const backendKind =
      payload.backend === "claude-code" ? "claude-code" : "cursor";
    const mode = payload.mode === "plan" ? "plan" : "agent";
    const runKey = makeRunKey(roomId, agentId);
    const repoPath = repoPathOverride || payloadCwd || payloadRepoPath;
    const cwd = payloadCwd || repoPath;
    const sessionId =
      payload.sessionId || lastSessionByAgent.get(runKey) || null;

    if (activeRuns.has(runKey)) {
      console.log(
        chalk.yellow(
          `  Rejecting new prompt — agent ${agentId} already running in room ${roomId}`,
        ),
      );
      emitOrQueue("worker:agent-event", {
        roomId,
        agentId,
        event: {
          kind: "error",
          message: "This agent is already running another prompt",
        } satisfies AgentStreamEvent,
      });
      emitOrQueue("worker:agent-event", {
        roomId,
        agentId,
        event: { kind: "done", result: "" } satisfies AgentStreamEvent,
      });
      return;
    }

    if (activeRuns.size >= MAX_CONCURRENT) {
      console.log(
        chalk.yellow(
          `  Rejecting new prompt — max concurrent agents (${MAX_CONCURRENT}) reached`,
        ),
      );
      emitOrQueue("worker:agent-event", {
        roomId,
        agentId,
        event: {
          kind: "error",
          message: `Worker is at max concurrent agents (${MAX_CONCURRENT})`,
        } satisfies AgentStreamEvent,
      });
      emitOrQueue("worker:agent-event", {
        roomId,
        agentId,
        event: { kind: "done", result: "" } satisfies AgentStreamEvent,
      });
      return;
    }

    const thisRun = ++runSeqCounter;
    const runState: RunState = {
      roomId,
      agentId,
      runSeq: thisRun,
      editedPaths: new Map(),
      pendingCallPaths: new Map(),
      emittedTerminal: false,
      abort: () => {},
    };
    activeRuns.set(runKey, runState);

    if (payload.attachments?.length) {
      try {
        writeWorkerAttachments(cwd, payload.attachments);
        console.log(
          chalk.gray(
            `  Saved ${payload.attachments.length} attachment(s) to ${cwd}/.steer-uploads`,
          ),
        );
      } catch (err) {
        const message =
          (err as Error).message || "Failed to save attached files";
        console.error(chalk.red(`  ✗ ${message}`));
        activeRuns.delete(runKey);
        emitOrQueue("worker:agent-event", {
          roomId,
          agentId,
          event: { kind: "error", message } satisfies AgentStreamEvent,
        });
        emitOrQueue("worker:agent-event", {
          roomId,
          agentId,
          event: { kind: "done", result: "" } satisfies AgentStreamEvent,
        });
        return;
      }
    }

    console.log(
      chalk.cyan(
        `\n━━━ Running prompt in room ${roomId} / agent ${agentId} ━━━`,
      ),
    );
    console.log(chalk.gray(`Cwd: ${cwd}`));
    console.log(chalk.gray(`Backend: ${backendKind}`));
    console.log(chalk.gray(`Model: ${modelId}`));
    console.log(
      chalk.gray(
        `Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "…" : ""}`,
      ),
    );

    // Process stream events in order. Fire-and-forget handlers used to race
    // lock acquisition / git diffs ahead of later tool_done rows, so chat
    // grouped cards often missed path + patch until the whole run finished.
    let eventQueue = Promise.resolve();
    const onEvent = (event: AgentStreamEvent) => {
      eventQueue = eventQueue
        .then(() => handleEvent(event))
        .catch((err) => {
          console.error(
            chalk.red(
              `  ✗ Event handler: ${(err as Error).message || String(err)}`,
            ),
          );
        });
    };

    const handleEvent = async (event: AgentStreamEvent) => {
      const current = activeRuns.get(runKey);
      if (!current || current.runSeq !== thisRun) return;

      if (
        event.kind === "tool_start" &&
        event.path &&
        event.callId &&
        event.name &&
        isEditTool(event.name)
      ) {
        const lock = await acquireFileLock(
          socket,
          roomId,
          agentId,
          event.path,
          event.callId,
        );
        if (!lock.granted) {
          const holder = lock.holderAgentId || "another agent";
          const message = `File \`${event.path}\` is locked by ${holder}. Wait for the other agent to finish or ask the host to release the lock.`;
          console.error(chalk.red(`  ✗ Lock denied: ${message}`));
          current.abort();
          abortRun(runKey);
          emitOrQueue("worker:agent-event", {
            roomId,
            agentId,
            event: { kind: "error", message } satisfies AgentStreamEvent,
          });
          finishRun({ kind: "error", message });
          return;
        }
      }

      let outgoing: AgentStreamEvent = event;

      if (event.kind === "tool_start") {
        console.log(chalk.yellow(`  ▸ ${event.name} ${event.detail}`));
        if (event.path && event.callId) {
          current.pendingCallPaths.set(event.callId, event.path);
        }
      } else if (event.kind === "tool_done") {
        const path =
          event.path ||
          (event.callId
            ? current.pendingCallPaths.get(event.callId)
            : undefined);
        console.log(
          chalk.green(
            `  ✓ ${event.name}${path ? ` ${path}` : ` ${event.detail}`}`,
          ),
        );
        if (path && event.name && isEditTool(event.name)) {
          emitOrQueue("worker:release-lock", { roomId, agentId, path });
        }
        if (isEditTool(event.name) && path && event.callId) {
          current.editedPaths.set(path, event.callId);
          await sleep(DIFF_WAIT_MS);
          if (activeRuns.get(runKey)?.runSeq !== thisRun) return;
          let patch = event.diffPatch?.trim() || "";
          try {
            const git = (await getFileDiff(cwd, path)).trim();
            if (git) patch = git;
          } catch {
            // synthetic parser patch is still useful
          }
          outgoing = {
            ...event,
            path,
            diffPatch: patch || event.diffPatch,
          };
          if (patch) {
            emitOrQueue("worker:file-diff", {
              roomId,
              agentId,
              callId: event.callId,
              toolName: event.name || "edit",
              path,
              patch,
            });
          }
        }
      } else if (event.kind === "assistant_final") {
        console.log(chalk.white(`  Assistant: ${event.text.slice(0, 120)}…`));
      } else if (event.kind === "session") {
        if (event.sessionId) lastSessionByAgent.set(runKey, event.sessionId);
        console.log(chalk.gray(`  session ${event.sessionId}`));
      } else if (event.kind === "error") {
        console.error(chalk.red(`  ✗ Error: ${event.message}`));
      } else if (event.kind === "done") {
        console.log(chalk.green("  ✓ Agent finished"));
      }

      if (outgoing.kind === "done" || outgoing.kind === "error") {
        current.emittedTerminal = true;
      }
      emitOrQueue("worker:agent-event", { roomId, agentId, event: outgoing });
    };

    const finishRun = (terminal?: AgentStreamEvent) => {
      const current = activeRuns.get(runKey);
      if (!current || current.runSeq !== thisRun) return;
      if (terminal && !current.emittedTerminal) {
        emitOrQueue("worker:agent-event", {
          roomId,
          agentId,
          event: terminal,
        });
        current.emittedTerminal = true;
      } else if (!current.emittedTerminal) {
        emitOrQueue("worker:agent-event", {
          roomId,
          agentId,
          event: { kind: "done", result: "" } satisfies AgentStreamEvent,
        });
        current.emittedTerminal = true;
      }
      activeRuns.delete(runKey);
    };

    const handle = runAgentWithHandle(
      cwd,
      prompt,
      modelId,
      onEvent,
      sessionId,
      runKey,
      backendKind,
      mode,
    );
    runState.abort = handle.abort;

    handle.promise
      .then(async () => {
        await eventQueue;
        const current = activeRuns.get(runKey);
        if (!current || current.runSeq !== thisRun) return;
        for (const [filePath, callId] of current.editedPaths) {
          try {
            const patch = await getFileDiff(cwd, filePath);
            if (patch) {
              emitOrQueue("worker:file-diff", {
                roomId,
                agentId,
                callId,
                toolName: "edit",
                path: filePath,
                patch,
              });
            }
          } catch {
            // diff failures are non-fatal
          }
        }
        finishRun({ kind: "done", result: "" });
      })
      .catch(async (err) => {
        await eventQueue;
        const current = activeRuns.get(runKey);
        if (!current || current.runSeq !== thisRun) return;
        const message = (err as Error).message || "Agent error";
        console.error(chalk.red(`Agent error: ${message}`));
        finishRun({ kind: "error", message });
        emitOrQueue("worker:agent-event", {
          roomId,
          agentId,
          event: { kind: "done", result: "" } satisfies AgentStreamEvent,
        });
      });
  });

  socket.on("worker:abort", (payload: AbortPayload) => {
    const agentId = payload.agentId;
    if (agentId) {
      const runKey = makeRunKey(payload.roomId, agentId);
      console.log(
        chalk.yellow(`  ⚠ Abort requested for ${payload.roomId}/${agentId}`),
      );
      const run = activeRuns.get(runKey);
      run?.abort();
      abortRun(runKey);
      activeRuns.delete(runKey);
    } else {
      // Legacy: abort all runs for the room
      console.log(
        chalk.yellow(`  ⚠ Abort requested for room ${payload.roomId}`),
      );
      for (const [key, run] of [...activeRuns.entries()]) {
        if (run.roomId === payload.roomId) {
          run.abort();
          abortRun(key);
          activeRuns.delete(key);
        }
      }
    }
  });

  socket.on("worker:revert-files", async (payload) => {
    console.log(
      chalk.yellow(
        `  ↺ Revert requested for ${payload.filePaths.length} file(s) in room ${payload.roomId}`,
      ),
    );
    try {
      const { reverted, errors } = await revertFiles(cwd, payload.filePaths);
      emitOrQueue("worker:files-reverted", {
        roomId: payload.roomId,
        agentId: payload.agentId,
        filePaths: reverted,
        messageId: payload.messageId,
        error: errors.length ? errors.join("; ") : undefined,
      });
    } catch (err) {
      emitOrQueue("worker:files-reverted", {
        roomId: payload.roomId,
        agentId: payload.agentId,
        filePaths: [],
        messageId: payload.messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  socket.on(
    "worker:pick-folder",
    async (payload: { requestId: string }) => {
      console.log(chalk.cyan("  📂 Opening folder picker…"));
      try {
        const path = await pickFolder();
        if (path) {
          console.log(chalk.green(`  ✓ Selected: ${path}`));
        } else {
          console.log(chalk.yellow("  Folder pick cancelled"));
        }
        emitOrQueue("worker:folder-picked", {
          requestId: payload.requestId,
          path,
        });
      } catch (err) {
        const message = (err as Error).message;
        console.error(chalk.red(`  ✗ Folder picker error: ${message}`));
        emitOrQueue("worker:folder-picked", {
          requestId: payload.requestId,
          path: null,
          error: message,
        });
      }
    },
  );

  socket.on(
    "worker:list-models",
    async (payload: { requestId: string }) => {
      console.log(chalk.cyan("  Listing Cursor models…"));
      try {
        const models = await listLocalModels();
        console.log(chalk.green(`  ✓ ${models.length} models`));
        emitOrQueue("worker:models-listed", {
          requestId: payload.requestId,
          models,
        });
      } catch (err) {
        const message = (err as Error).message;
        console.error(chalk.red(`  ✗ List models error: ${message}`));
        emitOrQueue("worker:models-listed", {
          requestId: payload.requestId,
          error: message,
        });
      }
    },
  );

  socket.on(
    "worker:list-sessions",
    (payload: { requestId: string; repoPath: string }) => {
      console.log(chalk.cyan(`  Listing Cursor chats for ${payload.repoPath}…`));
      try {
        const sessions = listChatSessions(payload.repoPath);
        console.log(chalk.green(`  ✓ ${sessions.length} chat(s)`));
        emitOrQueue("worker:sessions-listed", {
          requestId: payload.requestId,
          sessions,
        });
      } catch (err) {
        const message = (err as Error).message;
        console.error(chalk.red(`  ✗ List sessions error: ${message}`));
        emitOrQueue("worker:sessions-listed", {
          requestId: payload.requestId,
          sessions: [],
          error: message,
        });
      }
    },
  );

  process.on("SIGINT", () => {
    console.log(chalk.gray("\nShutting down worker…"));
    abortAll();
    socket.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    abortAll();
    socket.disconnect();
    process.exit(0);
  });
}
