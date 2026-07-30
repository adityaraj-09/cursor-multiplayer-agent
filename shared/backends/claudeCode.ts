import type {
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";

/**
 * Claude Code CLI backend — stubbed for this pass.
 * Intended argv: `claude -p --output-format stream-json --input-format stream-json`
 */
export class ClaudeCodeBackend implements WorkerBackend {
  readonly kind = "claude-code" as const;
  readonly available = false;
  readonly command = "claude";

  buildArgs(opts: BuildArgsOptions): string[] {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
    ];
    if (opts.modelId && opts.modelId !== "auto") {
      args.push("--model", opts.modelId);
    }
    if (opts.sessionId) {
      args.push("--resume", opts.sessionId);
    }
    args.push(opts.prompt);
    return args;
  }

  parseLine(
    _json: unknown,
    _ctx?: ParseLineContext,
  ): NormalizedAgentEvent[] {
    throw new Error(
      "Claude Code backend is not available yet — coming soon",
    );
  }
}

export const claudeCodeBackend = new ClaudeCodeBackend();
