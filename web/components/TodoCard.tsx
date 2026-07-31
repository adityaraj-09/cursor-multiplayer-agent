"use client";

import type { AgentTodoItem, ChatMessage } from "../../shared/events";
import { isTodoTool } from "../../shared/backends/cursor";

export function messageHasTodos(message: ChatMessage): boolean {
  return Boolean(
    (message.todos && message.todos.length > 0) ||
      (message.toolName && isTodoTool(message.toolName)),
  );
}

function StatusIcon({ status }: { status: AgentTodoItem["status"] }) {
  if (status === "completed") {
    return (
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#3ecf8e]/15 text-[#3ecf8e]"
        aria-hidden
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path
            d="M2.5 6.2 L5 8.5 L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#4d9fff]/15"
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#4d9fff] animate-pulse" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f07070]/12 text-[#f07070]/80"
        aria-hidden
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path
            d="M3.5 3.5 L8.5 8.5 M8.5 3.5 L3.5 8.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#3c3c3c]"
      aria-hidden
    />
  );
}

function statusLabel(status: AgentTodoItem["status"]): string {
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Done";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

export default function TodoCard({
  message,
  agentLabel,
}: {
  message: ChatMessage;
  agentLabel?: string;
}) {
  const todos = message.todos ?? [];
  const done = todos.filter((t) => t.status === "completed").length;
  const active = todos.filter((t) => t.status === "in_progress").length;

  return (
    <div className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[#2b2b2b]">
        <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
          Todos
        </span>
        {agentLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252525] text-[#a0a0a0]">
            {agentLabel}
          </span>
        )}
        <span className="text-[12px] text-[#a0a0a0] truncate min-w-0 flex-1">
          {todos.length
            ? `${done}/${todos.length} complete${active ? ` · ${active} active` : ""}`
            : message.content || "Updating todos"}
        </span>
        <span
          className={`text-[10px] shrink-0 ${
            message.status === "streaming"
              ? "text-[#4d9fff]"
              : message.status === "error"
                ? "text-[#f07070]"
                : "text-[#3ecf8e]"
          }`}
        >
          {message.status === "streaming"
            ? "updating"
            : message.status === "error"
              ? "error"
              : "saved"}
        </span>
      </div>

      {todos.length > 0 ? (
        <ul className="divide-y divide-[#2b2b2b]/80">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-start gap-2.5 px-3 py-2.5"
            >
              <StatusIcon status={todo.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] leading-snug break-words ${
                    todo.status === "completed"
                      ? "text-[#6e6e6e] line-through"
                      : todo.status === "cancelled"
                        ? "text-[#6e6e6e] line-through"
                        : "text-[#e4e4e4]"
                  }`}
                >
                  {todo.content}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6e6e6e]">
                  {statusLabel(todo.status)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2.5 text-[12px] text-[#6e6e6e] font-mono break-all">
          {message.content || "No todo details available"}
        </p>
      )}
    </div>
  );
}
