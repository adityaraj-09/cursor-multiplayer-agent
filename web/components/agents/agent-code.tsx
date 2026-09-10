"use client";

import { cn } from "../../lib/utils";

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript";

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export function AgentCode({
  code,
  language = "bash",
  className,
}: AgentCodeProps) {
  return (
    <pre
      data-language={language}
      className={cn(
        "m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/85",
        className,
      )}
    >
      {code}
    </pre>
  );
}
