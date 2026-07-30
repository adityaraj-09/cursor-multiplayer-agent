import { io, type Socket } from "socket.io-client";
import { hostname } from "os";
import { createHash } from "crypto";
import chalk from "chalk";
import { loadConfig } from "./config.js";
import { pickFolder } from "./pickFolder.js";
import { listLocalModels } from "./listModels.js";
import {
  runAgent,
  abortAgent,
  isEditTool,
  getFileDiff,
  type AgentStreamEvent,
} from "./agent.js";
import { listChatSessions } from "./listSessions.js";

interface RunPromptPayload {
  roomId: string;
  prompt: string;
  repoPath: string;
  modelId: string;
  sessionId?: string | null;
}

interface AbortPayload {
  roomId: string;
}

type QueuedEmit = { event: string; payload: unknown };

function generateWorkerId(email: string): string {
  const raw = `${hostname()}-${email}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
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

  let activeRoomId: string | null = null;
  let runSeq = 0;
  /** Events produced while offline — flushed on reconnect (agent keeps running). */
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

  const announceReady = () => {
    socket.emit("worker:ready", {
      workerId,
      machineName: hostname(),
      activeRoomId,
      busy: Boolean(activeRoomId),
    });
  };

  socket.on("connect", () => {
    console.log(chalk.green("✓ Connected to server"));
    if (activeRoomId) {
      console.log(
        chalk.cyan(
          `  Agent still running for room ${activeRoomId} — resuming stream`,
        ),
      );
    }
    announceReady();
    flushQueue();
  });

  socket.on("disconnect", (reason) => {
    console.log(chalk.yellow(`Disconnected: ${reason}`));
    if (activeRoomId) {
      console.log(
        chalk.yellow(
          `  Agent keeps running locally for room ${activeRoomId} (will sync on reconnect)`,
        ),
      );
    }
    // Do NOT abortAgent() — Cursor should finish even if the socket drops.
  });

  socket.on("connect_error", (err) => {
    console.error(chalk.red(`Connection error: ${err.message}`));
  });

  socket.on("worker:run-prompt", (payload: RunPromptPayload) => {
    const {
      roomId,
      prompt,
      repoPath: payloadRepoPath,
      modelId,
      sessionId,
    } = payload;
    const repoPath = repoPathOverride || payloadRepoPath;

    if (activeRoomId) {
      console.log(
        chalk.yellow(
          `  Rejecting new prompt — already running for room ${activeRoomId}`,
        ),
      );
      emitOrQueue("worker:agent-event", {
        roomId,
        event: {
          kind: "error",
          message: "Worker is already running another prompt",
        } satisfies AgentStreamEvent,
      });
      emitOrQueue("worker:agent-event", {
        roomId,
        event: { kind: "done", result: "" } satisfies AgentStreamEvent,
      });
      return;
    }

    const thisRun = ++runSeq;
    activeRoomId = roomId;

    console.log(chalk.cyan(`\n━━━ Running prompt in room ${roomId} ━━━`));
    console.log(chalk.gray(`Repo: ${repoPath}`));
    console.log(chalk.gray(`Model: ${modelId}`));
    console.log(
      chalk.gray(
        `Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "…" : ""}`,
      ),
    );

    const editedPaths = new Map<string, string>(); // path → callId
    let emittedTerminal = false;

    const onEvent = (event: AgentStreamEvent) => {
      if (thisRun !== runSeq) return;
      if (event.kind === "done" || event.kind === "error") {
        emittedTerminal = true;
      }
      emitOrQueue("worker:agent-event", { roomId, event });

      if (event.kind === "tool_start") {
        console.log(chalk.yellow(`  ▸ ${event.name} ${event.detail}`));
      } else if (event.kind === "tool_done") {
        console.log(chalk.green(`  ✓ ${event.name} ${event.detail}`));
        if (isEditTool(event.name) && event.path && event.callId) {
          editedPaths.set(event.path, event.callId);
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
      if (thisRun !== runSeq) return;
      if (terminal && !emittedTerminal) {
        emitOrQueue("worker:agent-event", { roomId, event: terminal });
        emittedTerminal = true;
      } else if (!emittedTerminal) {
        emitOrQueue("worker:agent-event", {
          roomId,
          event: { kind: "done", result: "" } satisfies AgentStreamEvent,
        });
        emittedTerminal = true;
      }
      if (activeRoomId === roomId) activeRoomId = null;
    };

    runAgent(repoPath, prompt, modelId, onEvent, sessionId)
      .then(async () => {
        if (thisRun !== runSeq) return;
        for (const [filePath, callId] of editedPaths) {
          try {
            const patch = await getFileDiff(repoPath, filePath);
            if (patch) {
              emitOrQueue("worker:file-diff", {
                roomId,
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
        if (thisRun !== runSeq) return;
        const message = (err as Error).message || "Agent error";
        console.error(chalk.red(`Agent error: ${message}`));
        finishRun({ kind: "error", message });
        emitOrQueue("worker:agent-event", {
          roomId,
          event: { kind: "done", result: "" } satisfies AgentStreamEvent,
        });
      });
  });

  socket.on("worker:abort", (_payload: AbortPayload) => {
    console.log(chalk.yellow("  ⚠ Abort requested"));
    abortAgent();
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
    abortAgent();
    socket.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    abortAgent();
    socket.disconnect();
    process.exit(0);
  });
}
