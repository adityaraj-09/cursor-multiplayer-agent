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

interface RunPromptPayload {
  roomId: string;
  prompt: string;
  repoPath: string;
  modelId: string;
}

interface AbortPayload {
  roomId: string;
}

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

  const socket: Socket = io(`${serverUrl}/worker`, {
    auth: { token: config.token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    console.log(chalk.green("✓ Connected to server"));
    socket.emit("worker:ready", {
      workerId,
      machineName: hostname(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(chalk.yellow(`Disconnected: ${reason}`));
  });

  socket.on("connect_error", (err) => {
    console.error(chalk.red(`Connection error: ${err.message}`));
  });

  socket.on("worker:run-prompt", (payload: RunPromptPayload) => {
    const { roomId, prompt, repoPath: payloadRepoPath, modelId } = payload;
    const repoPath = repoPathOverride || payloadRepoPath;

    console.log(chalk.cyan(`\n━━━ Running prompt in room ${roomId} ━━━`));
    console.log(chalk.gray(`Repo: ${repoPath}`));
    console.log(chalk.gray(`Model: ${modelId}`));
    console.log(chalk.gray(`Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "…" : ""}`));

    const editedPaths = new Set<string>();
    let lastMsgId = "";

    const onEvent = (event: AgentStreamEvent) => {
      socket.emit("worker:agent-event", { roomId, event });

      if (event.kind === "tool_start") {
        console.log(chalk.yellow(`  ▸ ${event.name} ${event.detail}`));
      } else if (event.kind === "tool_done") {
        console.log(chalk.green(`  ✓ ${event.name} ${event.detail}`));
        if (isEditTool(event.name) && event.path) {
          editedPaths.add(event.path);
          lastMsgId = event.callId;
        }
      } else if (event.kind === "assistant_final") {
        console.log(chalk.white(`  Assistant: ${event.text.slice(0, 120)}…`));
      } else if (event.kind === "error") {
        console.error(chalk.red(`  ✗ Error: ${event.message}`));
      } else if (event.kind === "done") {
        console.log(chalk.green("  ✓ Agent finished"));
      }
    };

    runAgent(repoPath, prompt, modelId, onEvent)
      .then(async () => {
        for (const filePath of editedPaths) {
          try {
            const patch = await getFileDiff(repoPath, filePath);
            if (patch) {
              socket.emit("worker:file-diff", {
                roomId,
                msgId: lastMsgId,
                toolName: "edit",
                path: filePath,
                patch,
              });
            }
          } catch {
            // diff failures are non-fatal
          }
        }
      })
      .catch((err) => {
        console.error(chalk.red(`Agent error: ${(err as Error).message}`));
        socket.emit("worker:agent-event", {
          roomId,
          event: { kind: "error", message: (err as Error).message } as AgentStreamEvent,
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
        socket.emit("worker:folder-picked", {
          requestId: payload.requestId,
          path,
        });
      } catch (err) {
        const message = (err as Error).message;
        console.error(chalk.red(`  ✗ Folder picker error: ${message}`));
        socket.emit("worker:folder-picked", {
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
        socket.emit("worker:models-listed", {
          requestId: payload.requestId,
          models,
        });
      } catch (err) {
        const message = (err as Error).message;
        console.error(chalk.red(`  ✗ List models error: ${message}`));
        socket.emit("worker:models-listed", {
          requestId: payload.requestId,
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
