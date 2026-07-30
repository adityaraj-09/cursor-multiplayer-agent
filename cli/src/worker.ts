import { io, type Socket } from "socket.io-client";
import { hostname } from "os";
import { createHash } from "crypto";
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
  type AgentStreamEvent,
} from "./agent.js";
import { listChatSessions } from "./listSessions.js";

const WORKER_PROTOCOL = 2;
const MAX_CONCURRENT = Number(process.env.STEER_MAX_CONCURRENT_AGENTS || 4);

interface RunPromptPayload {
  roomId: string;
  agentId?: string;
  prompt: string;
  repoPath: string;
  cwd?: string;
  modelId: string;
  sessionId?: string | null;
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
      sessionId,
    } = payload;
    const agentId = payload.agentId || "default";
    const runKey = makeRunKey(roomId, agentId);
    const repoPath = repoPathOverride || payloadCwd || payloadRepoPath;
    const cwd = payloadCwd || repoPath;

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

    console.log(
      chalk.cyan(
        `\n━━━ Running prompt in room ${roomId} / agent ${agentId} ━━━`,
      ),
    );
    console.log(chalk.gray(`Cwd: ${cwd}`));
    console.log(chalk.gray(`Model: ${modelId}`));
    console.log(
      chalk.gray(
        `Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "…" : ""}`,
      ),
    );

    const onEvent = (event: AgentStreamEvent) => {
      const current = activeRuns.get(runKey);
      if (!current || current.runSeq !== thisRun) return;
      if (event.kind === "done" || event.kind === "error") {
        current.emittedTerminal = true;
      }
      emitOrQueue("worker:agent-event", { roomId, agentId, event });

      if (event.kind === "tool_start") {
        console.log(chalk.yellow(`  ▸ ${event.name} ${event.detail}`));
        if (event.path && event.callId) {
          current.pendingCallPaths.set(event.callId, event.path);
        }
      } else if (event.kind === "tool_done") {
        console.log(chalk.green(`  ✓ ${event.name} ${event.detail}`));
        const path =
          event.path ||
          (event.callId
            ? current.pendingCallPaths.get(event.callId)
            : undefined);
        if (isEditTool(event.name) && path && event.callId) {
          current.editedPaths.set(path, event.callId);
          if (event.diffPatch) {
            emitOrQueue("worker:file-diff", {
              roomId,
              agentId,
              callId: event.callId,
              toolName: event.name || "edit",
              path,
              patch: event.diffPatch,
            });
          }
        }
      } else if (event.kind === "assistant_final") {
        console.log(chalk.white(`  Assistant: ${event.text.slice(0, 120)}…`));
      } else if (event.kind === "error") {
        console.error(chalk.red(`  ✗ Error: ${event.message}`));
      } else if (event.kind === "done") {
        console.log(chalk.green("  ✓ Agent finished"));
      }
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
    );
    runState.abort = handle.abort;

    handle.promise
      .then(async () => {
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
      .catch((err) => {
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
