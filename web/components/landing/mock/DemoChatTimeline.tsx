"use client";

import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  GitCompare,
  LoaderCircle,
  Search,
  SquareTerminal,
  User,
  Wrench,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { ToolApproval, ToolApprovalCode } from "../../agents/tool-approval";
import type { DemoBoardAgent, DemoChatItem, DemoToolCategory } from "./demo-chat";

export default function DemoChatTimeline({
  items,
  agents,
  filterAgentId,
  compact,
}: {
  items: DemoChatItem[];
  agents: DemoBoardAgent[];
  filterAgentId: string | null;
  compact?: boolean;
}) {
  const visible = filterAgentId
    ? items.filter((item) => item.agentId === filterAgentId)
    : items;
  const running = agents.some((agent) =>
    filterAgentId ? agent.id === filterAgentId && agent.running : agent.running,
  );
  const orbAgent = agents.find((agent) =>
    filterAgentId ? agent.id === filterAgentId && agent.running : agent.running,
  );

  return (
    <div className={`space-y-3 ${compact ? "py-2" : "py-3"}`}>
      {visible.map((item, index) => (
        <DemoChatBlock key={`${item.kind}-${item.agentId}-${index}`} item={item} />
      ))}
      {running && (
        <div className="flex items-center gap-2 py-1">
          <ThinkingOrb
            state="shaping"
            size={compact ? 20 : 64}
            theme="dark"
            aria-label="Agent is working"
          />
          {!compact && orbAgent && (
            <p className="text-[11px] text-[#6e6e6e]">
              {orbAgent.label} · {orbAgent.model}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DemoChatBlock({ item }: { item: DemoChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-2xl rounded-br-md border border-[#343434] bg-[#242424] px-3 py-2 shadow-[0_14px_35px_rgba(0,0,0,0.18)]">
          <div className="mb-1 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium"
              style={{ color: item.color }}
            >
              <User className="h-3 w-3" strokeWidth={1.8} />
              {item.name}
            </span>
            <span className="rounded-md bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#8a8a8a]">
              → {item.agentLabel}
            </span>
            <span className="font-mono text-[10px] text-[#4a4a4a]">{item.time}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[#f0f0f0]">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "assistant") {
    return (
      <div className="flex justify-start gap-2">
        <div className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] sm:flex">
          <Bot className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-[#2b2b2b] bg-[#191919] px-3 py-2 shadow-[0_14px_35px_rgba(0,0,0,0.14)]">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-medium text-[#a0a0a0]">{item.agentLabel}</span>
            <span className="font-mono text-[10px] text-[#4a4a4a]">{item.time}</span>
            {item.streaming && (
              <span className="text-[10px] text-[#4d9fff]">Streaming…</span>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-[#e4e4e4]">{item.text}</p>
        </div>
      </div>
    );
  }

  if (item.kind === "tools") return <ToolsCard item={item} />;
  if (item.kind === "todos") return <TodosCard item={item} />;
  return <ApprovalCard item={item} />;
}

function ToolsCard({
  item,
}: {
  item: Extract<DemoChatItem, { kind: "tools" }>;
}) {
  const [open, setOpen] = useState(item.open ?? item.running ?? false);
  const edits = item.tools.filter((tool) => tool.category === "edit").length;
  const done = item.tools.filter((tool) => tool.status === "done").length;

  return (
    <div className="overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#181818] shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full items-center gap-2.5 px-3 text-left hover:bg-[#1f1f1f]"
      >
        <span className={`text-[10px] text-[#6e6e6e] ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
          <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[#6e6e6e]">
          Tools
        </span>
        <span className="rounded-md bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
          {item.agentLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#a0a0a0]">
          {item.tools.length} tool call{item.tools.length === 1 ? "" : "s"}
        </span>
        {edits > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#26405d] bg-[#17202a] px-2 py-0.5 text-[10px] text-[#4d9fff]">
            <GitCompare className="h-3 w-3" strokeWidth={1.8} />
            {edits} edit{edits === 1 ? "" : "s"}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            item.running
              ? "border-[#26405d] bg-[#17202a] text-[#4d9fff]"
              : "border-[#234337] bg-[#17251f] text-[#3ecf8e]"
          }`}
        >
          {item.running ? (
            <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.8} />
          ) : (
            <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
          )}
          {item.running ? "running" : `${done}/${item.tools.length}`}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-[#2b2b2b] border-t border-[#2b2b2b]">
          {item.tools.map((tool) => (
            <div key={tool.title} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[#a0a0a0]">
                  <ToolIcon category={tool.category} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[#e4e4e4]">
                  {tool.title}
                </span>
                <span
                  className={`text-[10px] ${
                    tool.status === "streaming" ? "text-[#4d9fff]" : "text-[#3ecf8e]"
                  }`}
                >
                  {tool.status === "streaming" ? "running" : "done"}
                </span>
              </div>
              {tool.detail && (
                <p className="mt-1 pl-6 font-mono text-[11px] text-[#6e6e6e]">
                  {tool.detail}
                </p>
              )}
              {tool.diff && (
                <div className="landing-mono mt-1.5 overflow-hidden rounded-md border border-[#2b2b2b] text-[11px] leading-5">
                  <div className="border-l-2 border-[#f07070] bg-[rgba(240,112,112,0.08)] px-2 text-[#f07070]">
                    {tool.diff.del}
                  </div>
                  <div className="border-l-2 border-[#3ecf8e] bg-[rgba(62,207,142,0.08)] px-2 text-[#3ecf8e]">
                    {tool.diff.add}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TodosCard({
  item,
}: {
  item: Extract<DemoChatItem, { kind: "todos" }>;
}) {
  const done = item.items.filter((todo) => todo.status === "completed").length;
  const active = item.items.filter((todo) => todo.status === "in_progress").length;
  return (
    <div className="overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#1a1a1a]">
      <div className="flex h-9 items-center gap-2 border-b border-[#2b2b2b] px-3">
        <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Todos</span>
        <span className="rounded bg-[#252525] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]">
          {item.agentLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#a0a0a0]">
          {done}/{item.items.length} complete{active ? ` · ${active} active` : ""}
        </span>
      </div>
      <ul className="divide-y divide-[#2b2b2b]/80">
        {item.items.map((todo) => (
          <li key={todo.text} className="flex items-start gap-2.5 px-3 py-2">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                todo.status === "completed"
                  ? "bg-[#3ecf8e]/15 text-[#3ecf8e]"
                  : todo.status === "in_progress"
                    ? "bg-[#4d9fff]/15"
                    : "border border-[#3c3c3c]"
              }`}
            >
              {todo.status === "in_progress" && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4d9fff]" />
              )}
              {todo.status === "completed" && (
                <span className="text-[9px] leading-none">✓</span>
              )}
            </span>
            <p
              className={`text-[13px] leading-snug ${
                todo.status === "completed" ? "text-[#6e6e6e] line-through" : "text-[#e4e4e4]"
              }`}
            >
              {todo.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalCard({
  item,
}: {
  item: Extract<DemoChatItem, { kind: "approval" }>;
}) {
  const [approved, setApproved] = useState(item.status === "approved");
  const decided = approved || item.status === "approved";

  return (
    <ToolApproval
      tool="Shell"
      title="Allow this tool to run?"
      description={
        decided
          ? `${item.approver || "Maya"} approved this request.`
          : `${item.agentLabel} needs an approve. Driver can’t self-approve.`
      }
      agent={item.agentLabel}
      status={decided ? "approved" : "pending"}
      note={
        decided
          ? `${item.approver || "Maya"} approved · driver can’t self-approve`
          : undefined
      }
      parameters={[
        {
          id: "command",
          label: "Command",
          value: <ToolApprovalCode code={item.command} language="bash" />,
        },
      ]}
      defaultOpen={!decided}
      onApprove={decided ? undefined : () => setApproved(true)}
      onDeny={decided ? undefined : () => undefined}
    />
  );
}

function ToolIcon({ category }: { category: DemoToolCategory }) {
  if (category === "search") return <Search className="h-3.5 w-3.5" strokeWidth={1.75} />;
  if (category === "read") return <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />;
  if (category === "terminal") return <SquareTerminal className="h-3.5 w-3.5" strokeWidth={1.75} />;
  return <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />;
}
