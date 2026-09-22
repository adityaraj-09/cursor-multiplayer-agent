import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { API_PUBLIC_ORIGIN } from "../config.js";
import { log, logWarn } from "../logger.js";
import { getSwarm, getSwarmAgent } from "./store.js";
import { parseBearer, resolveSwarmCaller } from "./tokens.js";
import { SwarmToolError, runSwarmTool, toolsForRole } from "./tools.js";

export const SWARM_MCP_SERVER_NAME = "steer_swarm";
export const SWARM_MCP_PATH = "/api/swarm-mcp";

/** Public URL Cursor's backend calls on the agent's behalf. */
export function swarmMcpUrl(): string {
  const override = process.env.SWARM_MCP_URL?.trim();
  if (override) return override;
  return `${API_PUBLIC_ORIGIN.replace(/\/+$/, "")}${SWARM_MCP_PATH}`;
}

const INSTRUCTIONS =
  "Steer swarm message board. Every agent in this research swarm shares this board, " +
  "task graph, ledger, hypothesis tournament, and artifact store. Read the board before " +
  "you act, post evidence-backed findings, and record durable work as artifacts.";

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: status === 401 ? -32001 : -32000, message },
    id: null,
  });
}

export async function handleSwarmMcp(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, "Use POST (stateless Streamable HTTP)");
    return;
  }
  const caller = resolveSwarmCaller(parseBearer(req.headers.authorization));
  if (!caller) {
    logWarn("swarm", "mcp unauthorized", { ip: req.ip });
    jsonRpcError(res, 401, "Invalid or expired swarm token");
    return;
  }

  const server = new McpServer(
    { name: SWARM_MCP_SERVER_NAME, version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const def of toolsForRole(caller.agent.role)) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.input },
      async (args: unknown) => {
        const swarm = getSwarm(caller.swarm.id);
        const agent = getSwarmAgent(caller.agent.id);
        if (!swarm || !agent || agent.status === "retired") {
          return { content: [{ type: "text" as const, text: "This agent is no longer active." }], isError: true };
        }
        try {
          const text = runSwarmTool({ swarm, agent, now: Date.now() }, def.name, args);
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const message =
            err instanceof SwarmToolError
              ? err.message
              : err instanceof Error
                ? `Tool failed: ${err.message}`
                : "Tool failed";
          if (!(err instanceof SwarmToolError)) {
            logWarn("swarm", "tool crashed", { tool: def.name, agentId: agent.id, err });
          }
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logWarn("swarm", "mcp request failed", { err, agentId: caller.agent.id });
    if (!res.headersSent) jsonRpcError(res, 500, "Internal MCP error");
  }
  if (req.body && typeof req.body === "object" && (req.body as { method?: string }).method === "tools/call") {
    log("swarm", "mcp tool call", {
      swarmId: caller.swarm.id,
      agentId: caller.agent.id,
      tool: (req.body as { params?: { name?: string } }).params?.name,
    });
  }
}
